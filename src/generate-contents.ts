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
        let jsonStr = content;
        if (content.charCodeAt(0) === 0xFEFF) {
            jsonStr = content.slice(1);
        }
        return JSON.parse(jsonStr);
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
        console.warn('无法读取 parser.js 获取过时源数据列表，使用默认列表:', error);
    }

    return legacySources;
}

function buildNameToIdMap(dataArray: any[]): Map<string, string> {
    const nameToIdMap = new Map<string, string>();

    function removeChapterPrefix(name: string): string {
        const prefixes = [
            /^Chapter \d+: /i,
            /^Chapter \d+:/i,
            /^Chapter \d+ /i,
            /^Part \d+: /i,
            /^Part \d+:/i,
            /^Part \d+ /i,
            /^Appendix [A-Z]: /i,
            /^Appendix [A-Z]:/i,
            /^Appendix \d+:/i,
            /^Appendix \d+: /i,
            /^Appendix [A-Z] /i,
            /^Appendix [A-Z] /i,
            /^[A-Z]\d+. /i,
            /^[A-Z]\d+: /i,
			/^Encounter \d+: /i,
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

function convertHeaderName(header: string | any): string {
    if (typeof header === 'string') {
        return header;
    }
    if (header && typeof header === 'object' && header.header) {
        return header.header;
    }
    return '';
}

function convertHeadersToContents(
    enHeaders: Array<string | any> | undefined,
    zhHeaders: Array<string | any> | undefined,
    nameToIdMap: Map<string, string>,
    level: number = 0
): any[] {
    if (!enHeaders || !Array.isArray(enHeaders)) {
        return [];
    }

    const result: any[] = [];
    
    for (let i = 0; i < enHeaders.length; i++) {
        const enHeader = enHeaders[i];
        const zhHeader = zhHeaders?.[i];
        
        let enName = '';
        let zhName = '';
        
        if (typeof enHeader === 'string') {
            enName = enHeader;
            zhName = typeof zhHeader === 'string' ? zhHeader : '';
        } else if (enHeader && typeof enHeader === 'object') {
            if (enHeader.header) {
                enName = enHeader.header;
                zhName = typeof zhHeader === 'object' && zhHeader.header ? zhHeader.header : '';
            } else if (enHeader.name) {
                enName = enHeader.name;
                zhName = typeof zhHeader === 'object' && zhHeader.name ? zhHeader.name : '';
            } else if (enHeader.ENG_name) {
                enName = enHeader.ENG_name;
                zhName = typeof zhHeader === 'object' && zhHeader.name ? zhHeader.name : '';
            }
        }
        
        if (!enName) continue;

        const id = nameToIdMap.get(enName) || '';
        const ordinal = typeof enHeader === 'object' && enHeader.ordinal 
            ? enHeader.ordinal 
            : { type: 'text', identifier: 0 };

        const item: any = {
            displayName: {
                zh: zhName || '',
                en: enName,
            },
            ordinal: ordinal,
            source: '',
            headers: [],
            alonepage: true,
            id: id,
        };

        if (typeof enHeader === 'object' && enHeader.headers) {
            item.headers = convertHeadersToContents(
                enHeader.headers,
                typeof zhHeader === 'object' ? zhHeader.headers : undefined,
                nameToIdMap,
                level + 1
            );
        }

        result.push(item);
    }

    return result;
}

function convertBookContentsToTargetFormat(
    enBook: any,
    zhBook: any,
    nameToIdMap: Map<string, string>
): any[] {
    if (!enBook.contents || !Array.isArray(enBook.contents)) {
        return [];
    }

    const result: any[] = [];
    const zhContentsMap = new Map<string, any>();

    if (zhBook.contents && Array.isArray(zhBook.contents)) {
        for (const zhContent of zhBook.contents) {
            if (zhContent.ENG_name) {
                zhContentsMap.set(zhContent.ENG_name, zhContent);
            }
        }
    }

    for (const enContent of enBook.contents) {
        const zhContent = zhContentsMap.get(enContent.name);

        let ordinal = enContent.ordinal || { type: 'chapter', identifier: 0 };
        if (enContent.name === 'Credits') {
            ordinal = { ...ordinal, type: 'credits' };
        }

        const item: any = {
            displayName: {
                zh: zhContent?.name || '',
                en: enContent.name,
            },
            ordinal: ordinal,
            source: '',
            headers: convertHeadersToContents(
                enContent.headers,
                zhContent?.headers,
                nameToIdMap,
                1
            ),
            alonepage: true,
            id: nameToIdMap.get(enContent.name) || '',
        };

        result.push(item);
    }

    return result;
}

function findBookById(books: any[], id: string): any | undefined {
    if (!Array.isArray(books)) return undefined;
    return books.find((b: any) => b.id === id);
}

function convertToOutputFormat(
    enBook: any,
    zhBook: any,
    type: 'book' | 'adventure',
    booktypeConfig: Record<string, string[]> | null,
    coreOrder: Record<string, number>,
    legacySources: Set<string>,
    nameToIdMap: Map<string, string>
): any {
    const coverPath = (enBook.cover?.path || '').replace(/\//g, '-');
    const coverType = enBook.cover?.type || 'internal';

    let booktype = '';
    if (booktypeConfig) {
        for (const [_type, ids] of Object.entries(booktypeConfig)) {
            if (Array.isArray(ids) && ids.includes(enBook.id)) {
                booktype = _type;
                break;
            }
        }
    }

    const order = getOrderForBooktype(booktype, enBook.id, coreOrder);

    const result: any = {
        _hjschema: '出版物',
        id: enBook.id,
        dataType: type,
        booktype,
        tag: getTagsFromGroup(enBook.group),
        newest: !legacySources.has(enBook.id),
        id_zh: '',
        order,
        source: enBook.source || '',
        cover: {
            path: coverPath,
            type: coverType,
        },
        published: enBook.published || '',
        author: zhBook?.author || enBook.author || '',
        merge: '',
    };

    const zhName = zhBook?.name || '';
    const enName = enBook.ENG_name || enBook.name || '';
    if (zhName || enName) {
        result.displayName = {
            zh: zhName,
            en: enName,
        };
    }

    const contents = convertBookContentsToTargetFormat(enBook, zhBook, nameToIdMap);
    if (contents.length > 0) {
        result.contents = contents;
    }

    return result;
}

export const generateContents = async () => {
    try {
        console.log('[generateContents] 开始生成出版物目录');
        
        const [booksEn, booksZh, adventuresEn, adventuresZh, existingContents, booktypeConfig, coreOrder, legacySources] = await Promise.all([
            loadJsonFile(path.join(config.DATA_EN_DIR, 'books.json')),
            loadJsonFile(path.join(config.DATA_ZH_DIR, 'books.json')),
            loadJsonFile(path.join(config.DATA_EN_DIR, 'adventures.json')),
            loadJsonFile(path.join(config.DATA_ZH_DIR, 'adventures.json')),
            fs.readdir(extraConfig.CONFIG_CONTENTS_DIR).catch(() => []),
            loadJsonFile(extraConfig.BOOKTYPE_CONFIG).catch(() => null),
            loadJsonFile(extraConfig.CORE_ORDER_CONFIG).catch(() => {}),
            getLegacySources(),
        ]);

        const existingIds = new Set(existingContents.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
        console.log(`[generateContents] 已存在的自定义目录: ${existingIds.size} 个`);
        console.log(`[generateContents] 加载分类配置: ${booktypeConfig ? Object.keys(booktypeConfig).length + ' 个类别' : '未找到'}`);

        const outputBookDir = path.join(extraConfig.OUTPUT_CONTENTS_DIR, 'book');
        const outputAdventureDir = path.join(extraConfig.OUTPUT_CONTENTS_DIR, 'adventure');

        await fs.mkdir(outputBookDir, { recursive: true });
        await fs.mkdir(outputAdventureDir, { recursive: true });

        const allBookIds = new Set<string>();
        if (Array.isArray(booksZh.book)) {
            booksZh.book.forEach((b: any) => allBookIds.add(b.id));
        }
        if (Array.isArray(booksEn.book)) {
            booksEn.book.forEach((b: any) => allBookIds.add(b.id));
        }
        
        const allAdventureIds = new Set<string>();
        if (Array.isArray(adventuresZh.adventure)) {
            adventuresZh.adventure.forEach((a: any) => allAdventureIds.add(a.id));
        }
        if (Array.isArray(adventuresEn.adventure)) {
            adventuresEn.adventure.forEach((a: any) => allAdventureIds.add(a.id));
        }

        let generatedBookCount = 0;
        let generatedAdventureCount = 0;
        let copiedCount = 0;

        for (const bookId of allBookIds) {
            const enBook = findBookById(booksEn.book, bookId);
            const zhBook = findBookById(booksZh.book, bookId);

            if (!enBook && !zhBook) continue;

            const destDir = outputBookDir;
            const destPath = path.join(destDir, `${bookId}.json`);

            if (existingIds.has(bookId)) {
                const srcPath = path.join(extraConfig.CONFIG_CONTENTS_DIR, `${bookId}.json`);
                try {
                    let content = await fs.readFile(srcPath, 'utf-8');
                    if (content.charCodeAt(0) === 0xFEFF) {
                        content = content.slice(1);
                    }
                    const data = JSON.parse(content);
                    data.dataType = 'book';
                    await fs.writeFile(destPath, JSON.stringify(data, null, 4), 'utf-8');
                    copiedCount++;
                } catch (err) {
                    console.warn(`[generateContents] 复制 ${bookId} 失败:`, err);
                }
            } else {
                try {
                    const nameToIdMap = await loadBookContentFile(bookId, 'book');
                    const generatedBook = convertToOutputFormat(
                        enBook || {},
                        zhBook || {},
                        'book',
                        booktypeConfig,
                        coreOrder,
                        legacySources,
                        nameToIdMap
                    );
                    await fs.writeFile(destPath, JSON.stringify(generatedBook, null, 4), 'utf-8');
                    generatedBookCount++;
                } catch (err) {
                    console.warn(`[generateContents] 生成 ${bookId} 目录失败:`, err);
                }
            }
        }

        for (const adventureId of allAdventureIds) {
            const enAdventure = findBookById(adventuresEn.adventure, adventureId);
            const zhAdventure = findBookById(adventuresZh.adventure, adventureId);

            if (!enAdventure && !zhAdventure) continue;

            const destDir = outputAdventureDir;
            const destPath = path.join(destDir, `${adventureId}.json`);

            if (existingIds.has(adventureId)) {
                const srcPath = path.join(extraConfig.CONFIG_CONTENTS_DIR, `${adventureId}.json`);
                try {
                    let content = await fs.readFile(srcPath, 'utf-8');
                    if (content.charCodeAt(0) === 0xFEFF) {
                        content = content.slice(1);
                    }
                    const data = JSON.parse(content);
                    data.dataType = 'adventure';
                    await fs.writeFile(destPath, JSON.stringify(data, null, 4), 'utf-8');
                    copiedCount++;
                } catch (err) {
                    console.warn(`[generateContents] 复制 ${adventureId} 失败:`, err);
                }
            } else {
                try {
                    const nameToIdMap = await loadBookContentFile(adventureId, 'adventure');
                    const generatedAdventure = convertToOutputFormat(
                        enAdventure || {},
                        zhAdventure || {},
                        'adventure',
                        booktypeConfig,
                        coreOrder,
                        legacySources,
                        nameToIdMap
                    );
                    await fs.writeFile(destPath, JSON.stringify(generatedAdventure, null, 4), 'utf-8');
                    generatedAdventureCount++;
                } catch (err) {
                    console.warn(`[generateContents] 生成 ${adventureId} 目录失败:`, err);
                }
            }
        }
        
        console.log(`[generateContents] 生成书籍目录: ${generatedBookCount} 个`);
        console.log(`[generateContents] 生成模组目录: ${generatedAdventureCount} 个`);
        console.log(`[generateContents] 复制/合并已有目录: ${copiedCount} 个`);
        console.log(`[generateContents] 完成`);
        
        return { bookCount: generatedBookCount, adventureCount: generatedAdventureCount, copiedCount };
    } catch (e) {
        console.error('致命错误:', e);
        if (e instanceof Error) {
            console.error('错误堆栈:', e.stack);
        }
        throw e;
    }
};

if (import.meta.url === `file://${process.argv[1]}`) {
    generateContents();
}
