import fs from 'fs/promises';
import path from 'path';
import config from './config.js';

const extraConfig = {
    CONFIG_CONTENTS_DIR: './config/contents',
    OUTPUT_CONTENTS_DIR: './output/contents',
    BOOKTYPE_CONFIG: './config/booktype-config.json',
    CORE_ORDER_CONFIG: './config/core-book-order.json',
};

async function loadJsonFile<T = any>(filePath: string): Promise<T> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.warn(`Warning: Error loading ${filePath}:`, (e as Error).message);
        return {} as T;
    }
}

async function getLegacySources(): Promise<Set<string>> {
    const legacySources = new Set<string>([
        'PHB',
        'DMG',
        'MM',
        'VGM',
        'MTF',
    ]);

    try {
        const dataEnDir = path.dirname(config.DATA_EN_DIR);
        const parserJsPath = path.join(dataEnDir, 'js/parser.js');
        const content = await fs.readFile(parserJsPath, 'utf-8');

        const match = content.match(/Parser\.SOURCES_LEGACY_WOTC\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
        if (match && match[1]) {
            legacySources.clear();

            const varRegex = /Parser\.SRC_\w+/g;
            let varMatch;
            const legacyVars: string[] = [];
            while ((varMatch = varRegex.exec(match[1])) !== null) {
                legacyVars.push(varMatch[0]);
            }

            const srcVarRegex = /(Parser\.SRC_\w+)\s*=\s*['"]([^'"]+)['"]/g;
            const varToId: Record<string, string> = {};
            let srcMatch;
            while ((srcMatch = srcVarRegex.exec(content)) !== null) {
                varToId[srcMatch[1]] = srcMatch[2];
            }

            for (const legacyVar of legacyVars) {
                const bookId = varToId[legacyVar];
                if (bookId) {
                    legacySources.add(bookId);
                }
            }
        }
    } catch (error) {
        console.warn(`无法读取 parser.js 获取过时源数据列表，使用默认列表:`, error);
    }

    return legacySources;
}

function buildNameToIdMap(dataArray: any[]): Map<string, string> {
    const nameToIdMap = new Map<string, string>();

    function removeChapterPrefix(name: string): string {
        // 匹配各种章节前缀格式
        const prefixes = [
            /^Chapter \d+: /i,
            /^Chapter \d+ /i,
            /^Part \d+: /i,
            /^Part \d+ /i,
            /^Appendix [A-Z]: /i,
            /^Appendix [A-Z] /i,
        ];
        
        for (const prefix of prefixes) {
            if (prefix.test(name)) {
                return name.replace(prefix, '');
            }
        }
        return name;
    }

    function traverse(entries: any[]) {
        if (!Array.isArray(entries)) return;
        
        for (const entry of entries) {
            if (entry && typeof entry === 'object') {
                if (entry.name && entry.id) {
                    nameToIdMap.set(entry.name, entry.id);
                    const nameWithoutPrefix = removeChapterPrefix(entry.name);
                    if (nameWithoutPrefix !== entry.name) {
                        nameToIdMap.set(nameWithoutPrefix, entry.id);
                    }
                }
                
                if (Array.isArray(entry.entries)) {
                    traverse(entry.entries);
                }
            }
        }
    }

    traverse(dataArray);
    return nameToIdMap;
}

async function loadBookContentFile(bookId: string, type: 'book' | 'adventure'): Promise<Map<string, string>> {
    const dataDir = config.DATA_EN_DIR;
    const bookFileName = type === 'adventure' 
        ? `adventure-${bookId.toLowerCase()}.json` 
        : `book-${bookId.toLowerCase()}.json`;
    
    const bookFilePath = path.join(dataDir, type === 'adventure' ? 'adventure' : 'book', bookFileName);
    
    try {
        const content = await fs.readFile(bookFilePath, 'utf-8');
        const bookData = JSON.parse(content);
        return buildNameToIdMap(bookData.data || []);
    } catch (error) {
        return new Map();
    }
}

function getTagsFromGroup(group: string): string[] {
    const tagMap: Record<string, string[]> = {
        'core': ['三宝书'],
        'supplement': ['规则扩展'],
        'supplement-alt': ['规则扩展'],
        'setting': ['战役设定'],
        'setting-alt': ['战役设定'],
        'screen': ['城主帷幕'],
        'organized-play': ['官方战役'],
        'prerelease': ['预览版'],
        'homebrew': ['自制内容'],
        'recipe': ['食谱'],
        'homecraft': ['手工艺'],
        'other': ['其他'],
    };
    return tagMap[group] || [''];
}

function getOrderForBooktype(booktype: string, bookId: string, coreOrder: Record<string, number>): number {
    if (booktype === '核心') {
        return coreOrder[bookId] ?? 100;
    }
    const orderMap: Record<string, number> = {
        '扩展&资源': 7,
        '电子资源': 8,
        '其他资源': 9,
        '合作第三方': 10,
        '帷幕': 11,
        '贤者谏言&杂项出版物': 11,
        '模组': 100,
    };
    return orderMap[booktype] ?? 100;
}

function convertToOutputFormat(
    book: any, 
    type: 'book' | 'adventure',
    booktypeConfig: Record<string, string[]> | null,
    coreOrder: Record<string, number>,
    legacySources: Set<string>,
    nameToIdMap: Map<string, string>
) {
    const convertHeaders = (headers: Array<string | { index?: number; header: string }> = []) => {
        return headers.map((header) => {
            const headerObj = typeof header === 'string' ? { header } : header;
            return {
                name: headerObj.header,
                zh_name: headerObj.header,
                ordinal: { type: 'text', identifier: 0 },
                source: '',
                alonepage: false,
                headers: [],
            };
        });
    };

    const convertContents = (contents: any[]) => {
        if (!Array.isArray(contents)) return [];
        
        return contents.map((chapter, idx) => {
            const ordinal = chapter.ordinal || { type: 'chapter', identifier: idx + 1 };
            const headers = convertHeaders(chapter.headers);
            
            let id = '';
            const nameToMatch = chapter.ENG_name || chapter.name;
            if (nameToMatch) {
                id = nameToIdMap.get(nameToMatch) || '';
            }
            
            return {
                id,
                name: chapter.ENG_name || chapter.name,
                zh_name: chapter.name,
                ordinal: {
                    type: ordinal.type,
                    identifier: ordinal.identifier,
                },
                source: '',
                headers,
                alonepage: headers.length > 0,
            };
        });
    };

    const coverPath = (book.cover?.path || '').replace(/\//g, '-');
    const coverType = book.cover?.type || 'internal';

    let booktype = '';
    if (booktypeConfig) {
        for (const [typeName, ids] of Object.entries(booktypeConfig)) {
            if (Array.isArray(ids) && ids.includes(book.id)) {
                booktype = typeName;
                break;
            }
        }
    }

    const order = getOrderForBooktype(booktype, book.id, coreOrder);

    return {
        _hjschema: '出版物',
        name: book.ENG_name || book.name,
        zh_name: book.name,
        id: book.id,
        booktype,
        tag: getTagsFromGroup(book.group),
        newest: !legacySources.has(book.id),
        id_zh: '',
        order,
        source: book.source,
        cover: {
            path: coverPath,
            type: coverType,
        },
        published: book.published || '',
        author: book.author || '',
        merge: '',
        contents: convertContents(book.contents),
    };
}

export const generateContents = async () => {
    try {
        console.log('[generateContents] 开始生成出版物目录');
        
        const [booksEn, booksZh, adventuresEn, adventuresZh, existingContents, booktypeConfig, coreOrder] = await Promise.all([
            loadJsonFile(path.join(config.DATA_EN_DIR, 'books.json')),
            loadJsonFile(path.join(config.DATA_ZH_DIR, 'books.json')),
            loadJsonFile(path.join(config.DATA_EN_DIR, 'adventures.json')),
            loadJsonFile(path.join(config.DATA_ZH_DIR, 'adventures.json')),
            fs.readdir(extraConfig.CONFIG_CONTENTS_DIR).catch(() => []),
            loadJsonFile(extraConfig.BOOKTYPE_CONFIG).catch(() => null),
            loadJsonFile(extraConfig.CORE_ORDER_CONFIG).catch(() => {}),
        ]);

        const legacySources = await getLegacySources();

        const existingIds = new Set(existingContents.map(f => f.replace('.json', '')));
        console.log(`[generateContents] 已存在的自定义目录: ${existingIds.size} 个`);
        console.log(`[generateContents] 加载分类配置: ${booktypeConfig ? Object.keys(booktypeConfig).length + ' 个类别' : '未找到'}`);

        const outputBookDir = path.join(extraConfig.OUTPUT_CONTENTS_DIR, 'book');
        const outputAdventureDir = path.join(extraConfig.OUTPUT_CONTENTS_DIR, 'adventure');

        await fs.mkdir(outputBookDir, { recursive: true });
        await fs.mkdir(outputAdventureDir, { recursive: true });

        const books = [...(Array.isArray(booksZh.book) ? booksZh.book : []), ...(Array.isArray(booksEn.book) ? booksEn.book : [])];
        const adventures = [...(Array.isArray(adventuresZh.adventure) ? adventuresZh.adventure : []), ...(Array.isArray(adventuresEn.adventure) ? adventuresEn.adventure : [])];

        const bookMap = new Map<string, any>();
        books.forEach(book => {
            if (!bookMap.has(book.id)) {
                bookMap.set(book.id, book);
            }
        });

        const adventureMap = new Map<string, any>();
        adventures.forEach(adv => {
            if (!adventureMap.has(adv.id)) {
                adventureMap.set(adv.id, adv);
            }
        });

        let bookCount = 0;
        for (const [id, book] of bookMap) {
            if (existingIds.has(id)) {
                continue;
            }

            try {
                const nameToIdMap = await loadBookContentFile(id, 'book');
                const output = convertToOutputFormat(book, 'book', booktypeConfig, coreOrder, legacySources, nameToIdMap);
                const outputPath = path.join(outputBookDir, `${id}.json`);
                await fs.writeFile(outputPath, JSON.stringify(output, null, 4), 'utf-8');
                bookCount++;
            } catch (err) {
                console.warn(`Failed to process book ${id}:`, err);
            }
        }
        console.log(`[generateContents] 生成扩展目录：${bookCount} 个`);

        let adventureCount = 0;
        for (const [id, adventure] of adventureMap) {
            if (existingIds.has(id)) {
                continue;
            }

            try {
                const nameToIdMap = await loadBookContentFile(id, 'adventure');
                const output = convertToOutputFormat(adventure, 'adventure', booktypeConfig, coreOrder, legacySources, nameToIdMap);
                const outputPath = path.join(outputAdventureDir, `${id}.json`);
                await fs.writeFile(outputPath, JSON.stringify(output, null, 4), 'utf-8');
                adventureCount++;
            } catch (err) {
                console.warn(`[generateContents] Failed to process adventure ${id}:`, err);
            }
        }
        console.log(`[generateContents] 生成模组目录：${adventureCount} 个`);

        // 复制已有目录到 output
        const allBookIds = new Set<string>([...(booksZh.book || []), ...(booksEn.book || [])].map(b => b.id));
        const allAdventureIds = new Set<string>([...(adventuresZh.adventure || []), ...(adventuresEn.adventure || [])].map(a => a.id));
        let copiedCount = 0;

        for (const filename of existingContents) {
            if (!filename.endsWith('.json')) continue;
            const id = filename.replace('.json', '');
            
            const srcPath = path.join(extraConfig.CONFIG_CONTENTS_DIR, filename);
            let destDir: string;
            
            if (allBookIds.has(id)) {
                destDir = outputBookDir;
            } else if (allAdventureIds.has(id)) {
                destDir = outputAdventureDir;
            } else {
                // 默认按 booktype-config 里的类型判断
                destDir = outputBookDir;
                if (booktypeConfig) {
                    for (const [type, ids] of Object.entries(booktypeConfig)) {
                        if (type === '模组' && Array.isArray(ids) && ids.includes(id)) {
                            destDir = outputAdventureDir;
                            break;
                        }
                    }
                }
            }
            
            try {
                const destPath = path.join(destDir, filename);
                await fs.copyFile(srcPath, destPath);
                copiedCount++;
            } catch (err) {
                console.warn(`[generateContents] Failed to copy ${filename}:`, err);
            }
        }
        
        console.log(`[generateContents] 复制已有目录：${copiedCount} 个`);
        console.log(`[generateContents] 完成`);
        
        return { bookCount, adventureCount, copiedCount };
    } catch (e) {
        console.error('Fatal error:', e);
        if (e instanceof Error) {
            console.error('Error stack:', e.stack);
        }
        throw e;
    }
};

// 直接运行时的入口
if (import.meta.url === `file://${process.argv[1]}`) {
    generateContents();
}
