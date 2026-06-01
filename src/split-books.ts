import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { escapeFileName, sectionTextIdMap } from './exporters/shared.js';

const removeBOM = (content: string): string => {
    if (content.startsWith('\uFEFF')) {
        return content.slice(1);
    }
    return content;
};

const ENTRIES_WITH_ENUMERATED_TITLES = [
    {type: "section", key: "entries", depth: -1},
    {type: "entries", key: "entries", depthIncrement: 1},
    {type: "options", key: "entries"},
    {type: "inset", key: "entries", depth: 2},
    {type: "insetReadaloud", key: "entries", depth: 2},
    {type: "variant", key: "entries", depth: 2},
    {type: "variantInner", key: "entries", depth: 2},
    {type: "actions", key: "entries", depth: 2},
    {type: "flowBlock", key: "entries", depth: 2},
    {type: "optfeature", key: "entries", depthIncrement: 1},
    {type: "patron", key: "entries"},
];

const ENTRIES_WITH_ENUMERATED_TITLES_LOOKUP = Object.fromEntries(
    ENTRIES_WITH_ENUMERATED_TITLES.map(it => [it.type, it])
);

const processEntriesWithTitleFork = (entries: any[], depth: number = 0, parentType?: string): any[] => {
    if (!Array.isArray(entries)) return entries;
    
    return entries.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            return entry;
        }
        
        const processedEntry = { ...entry };
        const currentType = processedEntry.type;
        
        const entryConfig = ENTRIES_WITH_ENUMERATED_TITLES_LOOKUP[currentType];
        
        if (entryConfig && entry.name != null) {
            let titleDepth = depth;
            if (entryConfig?.depth !== undefined) {
                titleDepth = entryConfig.depth;
            } else if (entryConfig?.depthIncrement) {
                titleDepth = depth + 1;
            } else if (currentType === 'section') {
                titleDepth = -1;
            }
            titleDepth = Math.min(Math.max(titleDepth, -1), 2);
            
            if (titleDepth < 2) {
                if ('ENG_name' in processedEntry) {
                    processedEntry.ENG_title = processedEntry.ENG_name;
                    delete processedEntry.ENG_name;
                }
                if ('name' in processedEntry) {
                    processedEntry.title = processedEntry.name;
                    delete processedEntry.name;
                }
                processedEntry.title_fork = titleDepth + 1;
            }
        }
        
        if (Array.isArray(processedEntry.entries)) {
            let nextDepth = depth;
            
            if (currentType === 'section') {
                nextDepth = -1;
            } else if (entryConfig?.depth !== undefined) {
                nextDepth = entryConfig.depth;
            } else if (entryConfig?.depthIncrement) {
                nextDepth = depth + 1;
            }
            
            nextDepth = Math.min(Math.max(nextDepth, -1), 2);
            
            processedEntry.entries = processEntriesWithTitleFork(processedEntry.entries, nextDepth, currentType);
        }
        
        return processedEntry;
    });
};

const removeChapterPrefix = (name: string): string => {
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
};

const buildNameToIdMap = (data: any[]): Map<string, string> => {
    const map = new Map<string, string>();
    const traverse = (entries: any[]) => {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (entry && typeof entry === 'object') {
                if (entry.name && entry.id) {
                    map.set(entry.name, entry.id);
                    const nameWithoutPrefix = removeChapterPrefix(entry.name);
                    if (nameWithoutPrefix !== entry.name) {
                        map.set(nameWithoutPrefix, entry.id);
                    }
                }
                if (Array.isArray(entry.entries)) {
                    traverse(entry.entries);
                }
            }
        }
    };
    traverse(data);
    return map;
};

const loadBookContentFile = async (bookId: string, type: 'book' | 'adventure'): Promise<{
    zh: any[] | null;
    en: any[] | null;
}> => {
    const baseFileName = type === 'adventure' ? 'adventure-' : 'book-';
    const fileName = baseFileName + bookId.toLowerCase() + '.json';

    const enPath = path.join(config.DATA_EN_DIR, type, fileName);
    const zhPath = path.join(config.DATA_ZH_DIR, type, fileName);

    let enData: any[] | null = null;
    let zhData: any[] | null = null;

    try {
        const enContent = await fs.readFile(enPath, 'utf-8');
        const parsed = JSON.parse(enContent).data;
        enData = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (e) {
        // 英文数据不存在，跳过
    }

    try {
        const zhContent = await fs.readFile(zhPath, 'utf-8');
        const parsed = JSON.parse(zhContent).data;
        zhData = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (e) {
        // 中文数据不存在，跳过
    }

    return { zh: zhData, en: enData };
};

const extractEnNameFromEntry = (entry: any): string => {
    if (entry.displayName?.en) return entry.displayName.en;
    if (entry.ENG_name) return entry.ENG_name;
    if (entry.name) return entry.name;
    return '';
};

const extractZhNameFromEntry = (entry: any): string => {
    if (entry.displayName?.zh) return entry.displayName.zh;
    if (entry.zh_name) return entry.zh_name;
    if (entry.name) return entry.name;
    return '';
};

const numberToChinese = (num: number): string => {
    const chineseNumbers = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
    if (num >= 1 && num <= 20) {
        return chineseNumbers[num];
    }
    return num.toString();
};

const getDisplayNameWithPrefix = (enName: string, zhName: string, ordinal: any): { en: string, zh: string } => {
    let displayEn = enName;
    let displayZh = zhName;

    if (ordinal?.type === 'chapter' && ordinal.identifier !== undefined) {
        const identifier = ordinal.identifier;
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            displayEn = `Chapter ${identifier}: ${enName}`;
            displayZh = `第${chineseNum}章：${zhName}`;
        }
    } else if (ordinal?.type === 'appendix' && ordinal.identifier !== undefined) {
        const identifier = ordinal.identifier;
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            displayEn = `Appendix ${identifier}: ${enName}`;
            displayZh = `附录${chineseNum}：${zhName}`;
        }
    }

    return { en: displayEn, zh: displayZh };
};

const findSectionById = (data: any[], targetId: string): any | null => {
    const findById = (entries: any[]): any | null => {
        for (const entry of entries) {
            if (entry && typeof entry === 'object') {
                if (entry.id === targetId) {
                    return entry;
                }
                if (Array.isArray(entry.entries)) {
                    const found = findById(entry.entries);
                    if (found) return found;
                }
            }
        }
        return null;
    };

    return findById(data);
};

interface ProcessedSection {
    id: string;
    subpageId?: string;
    zhEntries: any[];
    enEntries: any[];
}

const replaceSectionsWithSubpages = (
    entries: any[],
    headerSubpageMap: Map<string, string>
): any[] => {
    const result: any[] = [];

    for (const ent of entries) {
        if (ent && typeof ent === 'object') {
            if (ent.id && headerSubpageMap.has(ent.id)) {
                result.push({
                    type: 'subpage',
                    id: headerSubpageMap.get(ent.id)
                });
            } else if (Array.isArray(ent.entries)) {
                result.push({
                    ...ent,
                    entries: replaceSectionsWithSubpages(ent.entries, headerSubpageMap)
                });
            } else {
                result.push(ent);
            }
        } else {
            result.push(ent);
        }
    }

    return result;
};

const processContentEntry = async (
    entry: any,
    bookId: string,
    bookType: 'book' | 'adventure',
    outputDir: string,
    nameToIdMap: Map<string, string>,
    enData: any[],
    zhData: any[],
    chapterIndex?: number
): Promise<ProcessedSection | null> => {
    const enName = extractEnNameFromEntry(entry);
    const zhName = extractZhNameFromEntry(entry);
    const nameForId = enName || zhName;
    let sectionId = entry.id || '';

    if (!sectionId && nameForId) {
        sectionId = nameToIdMap.get(nameForId) || nameToIdMap.get(removeChapterPrefix(nameForId)) || '';
    }

    if (!sectionId) {
       // console.log(`  警告: 无法找到章节 ID，跳过: ${enName || zhName}`);
        return null;
    }

    const sectionEn = sectionId ? findSectionById(enData, sectionId) : null;
    const sectionZh = sectionId ? findSectionById(zhData, sectionId) : null;

    const finalId = `${sectionId}|${bookId}`;

    if (entry.alonepage) {
        const dataType = "text";
        const uid = `${bookType}_${sectionId}|${bookId}`;
        const page = sectionEn?.page || sectionZh?.page || 0;
        const type = sectionEn?.type || sectionZh?.type || 'section';

        let enContent = sectionEn ? { ...sectionEn, entries: [...sectionEn.entries] } : null;
        let zhContent = sectionZh ? { ...sectionZh, entries: [...sectionZh.entries] } : null;

        const headerSubpageMap = new Map<string, string>();

        if (entry.headers && Array.isArray(entry.headers)) {
            for (const header of entry.headers) {
                if (header.alonepage) {
                    const headerProcessed = await processContentEntry(
                        header,
                        bookId,
                        bookType,
                        outputDir,
                        nameToIdMap,
                        enData,
                        zhData
                    );

                    if (headerProcessed?.subpageId && header.id) {
                        headerSubpageMap.set(header.id, headerProcessed.subpageId);
                    }
                }
            }
        }

        if (zhContent && headerSubpageMap.size > 0) {
            zhContent.entries = replaceSectionsWithSubpages(zhContent.entries, headerSubpageMap);
        }
        if (enContent && headerSubpageMap.size > 0) {
            enContent.entries = replaceSectionsWithSubpages(enContent.entries, headerSubpageMap);
        }

        if (zhContent) {
            zhContent.entries = processEntriesWithTitleFork(zhContent.entries);
        }
        if (enContent) {
            enContent.entries = processEntriesWithTitleFork(enContent.entries);
        }

        const fileData = {
            dataType,
            uid,
            id: finalId,
            textid: sectionId,
            source: bookId,
            page,
            type: entry.ordinal?.type || type,
            identifier: entry.ordinal?.identifier,
            ordinal: entry.ordinal,
            displayName: {
                zh: zhName || null,
                en: enName || null,
            },
            zh: zhContent,
            en: enContent,
        };

        const preferredFileName = `${escapeFileName(sectionId)}.json`;
        const bookOutputDir = path.join(outputDir, bookType, bookId);
        await fs.mkdir(bookOutputDir, { recursive: true });
        const filePath = path.join(bookOutputDir, preferredFileName);

        await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
       // console.log(`  生成: ${filePath}`);
        
        // 添加到章节映射
        sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, enName);
        if (zhName && zhName !== enName) {
            sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, zhName);
        }

        return {
            id: sectionId,
            subpageId: finalId,
            zhEntries: [],
            enEntries: []
        };
    } else {
        let zhEntries: any[] = [];
        let enEntries: any[] = [];

        if (sectionZh?.entries) {
            zhEntries = [...sectionZh.entries];
        }
        if (sectionEn?.entries) {
            enEntries = [...sectionEn.entries];
        }

        const headerSubpageMap = new Map<string, string>();
        const nonAlonePageHeaders: Array<{ id: string; zhEntries: any[]; enEntries: any[] }> = [];

        if (entry.headers && Array.isArray(entry.headers)) {
            for (const header of entry.headers) {
                const processedHeader = await processContentEntry(
                    header,
                    bookId,
                    bookType,
                    outputDir,
                    nameToIdMap,
                    enData,
                    zhData
                );

                if (processedHeader) {
                    if (processedHeader.subpageId && header.id) {
                        headerSubpageMap.set(header.id, processedHeader.subpageId);
                    } else if (header.id) {
                        nonAlonePageHeaders.push({
                            id: header.id,
                            zhEntries: processedHeader.zhEntries,
                            enEntries: processedHeader.enEntries
                        });
                    }
                }
            }
        }

        if (headerSubpageMap.size > 0) {
            zhEntries = replaceSectionsWithSubpages(zhEntries, headerSubpageMap);
            enEntries = replaceSectionsWithSubpages(enEntries, headerSubpageMap);
        }

        return {
            id: sectionId,
            zhEntries,
            enEntries
        };
    }
};

const writeSectionFile = async (
    sectionId: string,
    zhEntries: any[],
    enEntries: any[],
    enName: string,
    zhName: string,
    ordinal: any,
    bookId: string,
    bookType: 'book' | 'adventure',
    outputDir: string,
    enData: any[],
    zhData: any[],
    chapterIndex?: number
) => {
    const sectionEn = sectionId ? findSectionById(enData, sectionId) : null;
    const sectionZh = sectionId ? findSectionById(zhData, sectionId) : null;

    const dataType = bookType;
    const uid = `${bookType}_${sectionId}|${bookId}`;
    const finalId = `${sectionId}|${bookId}`;
    const page = sectionEn?.page || sectionZh?.page || 0;
    const type = sectionEn?.type || sectionZh?.type || 'section';

    const processedZhEntries = processEntriesWithTitleFork(zhEntries);
    const processedEnEntries = processEntriesWithTitleFork(enEntries);
    
    const enContent = { entries: processedEnEntries };
    const zhContent = { entries: processedZhEntries };

    const fileData = {
        dataType,
        uid,
        id: finalId,
        textid: sectionId,
        source: bookId,
        page,
        type: ordinal?.type || type,
        identifier: ordinal?.identifier,
        displayName: {
            zh: zhName || null,
            en: enName || null,
        },
        zh: zhContent,
        en: enContent,
    };

    const preferredFileName = `${escapeFileName(sectionId)}.json`;
    const bookOutputDir = path.join(outputDir, bookType, bookId);
    await fs.mkdir(bookOutputDir, { recursive: true });
    const filePath = path.join(bookOutputDir, preferredFileName);

    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
    
    // 添加到章节映射
    sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, enName);
    if (zhName && zhName !== enName) {
        sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, zhName);
    }
};

const processSingleBook = async (
    bookData: any,
    bookType: 'book' | 'adventure',
    outputDir: string,
    contentPath: string
) => {
    const bookId = bookData.id;

    const bookContent = await loadBookContentFile(bookId, bookType);
    const nameToIdMap = buildNameToIdMap(bookContent.en || bookContent.zh || []);

    let contentData: any = null;
    try {
        const contentRaw = await fs.readFile(contentPath, 'utf-8');
        contentData = JSON.parse(removeBOM(contentRaw));
    } catch (e) {
        return;
    }

    if (!contentData.contents) {
        return;
    }

    for (let chapterIndex = 0; chapterIndex < contentData.contents.length; chapterIndex++) {
        const entry = contentData.contents[chapterIndex];
        const enName = extractEnNameFromEntry(entry);
        const zhName = extractZhNameFromEntry(entry);
        const nameForId = enName || zhName;
        let sectionId = entry.id || '';

        if (!sectionId && nameForId) {
            sectionId = nameToIdMap.get(nameForId) || nameToIdMap.get(removeChapterPrefix(nameForId)) || '';
        }

        if (entry.alonepage && sectionId) {
            await processContentEntry(
                entry,
                bookId,
                bookType,
                outputDir,
                nameToIdMap,
                bookContent.en || [],
                bookContent.zh || [],
                chapterIndex
            );
        } else if (sectionId) {
            const processed = await processContentEntry(
                entry,
                bookId,
                bookType,
                outputDir,
                nameToIdMap,
                bookContent.en || [],
                bookContent.zh || [],
                chapterIndex
            );

            if (processed) {
                await writeSectionFile(
                    sectionId,
                    processed.zhEntries,
                    processed.enEntries,
                    enName,
                    zhName,
                    entry.ordinal,
                    bookId,
                    bookType,
                    outputDir,
                    bookContent.en || [],
                    bookContent.zh || [],
                    chapterIndex
                );
            }
        } else {
           //  console.log(`  处理没有 ID 的章节: ${enName || zhName}`);
            if (entry.headers && Array.isArray(entry.headers)) {
                for (const header of entry.headers) {
                    const headerEnName = extractEnNameFromEntry(header);
                    const headerZhName = extractZhNameFromEntry(header);
                    const headerSectionId = header.id || '';

                    if (!headerSectionId) {
                       // console.log(`    警告: 无法找到子章节 ID，跳过: ${headerEnName || headerZhName}`);
                        continue;
                    }

                    if (header.alonepage) {
                        await processContentEntry(
                            header,
                            bookId,
                            bookType,
                            outputDir,
                            nameToIdMap,
                            bookContent.en || [],
                            bookContent.zh || [],
                            chapterIndex
                        );
                    } else {
                        const processed = await processContentEntry(
                            header,
                            bookId,
                            bookType,
                            outputDir,
                            nameToIdMap,
                            bookContent.en || [],
                            bookContent.zh || [],
                            chapterIndex
                        );

                        if (processed) {
                            await writeSectionFile(
                                headerSectionId,
                                processed.zhEntries,
                                processed.enEntries,
                                headerEnName,
                                headerZhName,
                                header.ordinal,
                                bookId,
                                bookType,
                                outputDir,
                                bookContent.en || [],
                                bookContent.zh || [],
                                chapterIndex
                            );
                        }
                    }
                }
            }
        }
    }
};

const loadBooksJson = async (): Promise<{ en: any[]; zh: any[] }> => {
    const enPath = path.join(config.DATA_EN_DIR, 'books.json');
    const zhPath = path.join(config.DATA_ZH_DIR, 'books.json');
    
    let enData: any[] = [];
    let zhData: any[] = [];
    
    try {
        const enContent = await fs.readFile(enPath, 'utf-8');
        enData = JSON.parse(enContent).book || [];
    } catch (e) {
        // 英文 books.json 不存在
    }
    
    try {
        const zhContent = await fs.readFile(zhPath, 'utf-8');
        zhData = JSON.parse(zhContent).book || [];
    } catch (e) {
        // 中文 books.json 不存在
    }
    
    return { en: enData, zh: zhData };
};

const loadAdventuresJson = async (): Promise<{ en: any[]; zh: any[] }> => {
    const enPath = path.join(config.DATA_EN_DIR, 'adventures.json');
    const zhPath = path.join(config.DATA_ZH_DIR, 'adventures.json');
    
    let enData: any[] = [];
    let zhData: any[] = [];
    
    try {
        const enContent = await fs.readFile(enPath, 'utf-8');
        enData = JSON.parse(enContent).adventure || [];
    } catch (e) {
        // 英文 adventures.json 不存在
    }
    
    try {
        const zhContent = await fs.readFile(zhPath, 'utf-8');
        zhData = JSON.parse(zhContent).adventure || [];
    } catch (e) {
        // 中文 adventures.json 不存在
    }
    
    return { en: enData, zh: zhData };
};

const main = async () => {
    try {
        console.log('[splitBooks] 开始分割书籍和冒险');

        const outputDir = './output';

        // 从原始 books.json 和 adventures.json 中读取书籍和冒险列表
        const { en: enBooks, zh: zhBooks } = await loadBooksJson();
        const { en: enAdventures, zh: zhAdventures } = await loadAdventuresJson();

        const bookIds = new Set<string>();
        const adventureIds = new Set<string>();

        // 从原始数据中收集书籍ID
        for (const book of [...enBooks, ...zhBooks]) {
            if (book.id) {
                bookIds.add(book.id);
            }
        }
        
        // 从原始数据中收集冒险ID
        for (const adventure of [...enAdventures, ...zhAdventures]) {
            if (adventure.id) {
                adventureIds.add(adventure.id);
            }
        }

        // 也检查生成的内容目录作为后备
        for (const dir of ['config/contents', 'output/contents/book', 'output/contents/adventure']) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const id = file.replace('.json', '');
                    if (dir.includes('/adventure')) {
                        adventureIds.add(id);
                    } else {
                        bookIds.add(id);
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // 生成 adventure namelist
        await generateAdventureNameList(outputDir);

        console.log('[splitBooks] 完成');
    } catch (e) {
        console.error('[splitBooks] 致命错误:', e);
        if (e instanceof Error) {
            console.error('[splitBooks] 错误堆栈:', e.stack);
        }
        process.exit(1);
    }
};

const generateAdventureNameList = async (outputDir: string) => {
    try {
        const adventureDir = path.join(outputDir, 'adventure');
        const namelistDir = path.join(outputDir, 'namelist');
        await fs.mkdir(namelistDir, { recursive: true });

        const adventureDataList: Array<{
            id: string;
            src: string;
            name_en: string;
            name_zh: string;
        }> = [];

        let sourceDirs;
        try {
            sourceDirs = await fs.readdir(adventureDir);
        } catch {
            return;
        }

        for (const sourceId of sourceDirs) {
            const sourcePath = path.join(adventureDir, sourceId);
            let stats;
            try {
                stats = await fs.stat(sourcePath);
            } catch {
                continue;
            }
            if (!stats.isDirectory()) continue;

            let files;
            try {
                files = await fs.readdir(sourcePath);
            } catch {
                continue;
            }

            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const filePath = path.join(sourcePath, file);
                let content;
                try {
                    content = await fs.readFile(filePath, 'utf-8');
                } catch {
                    continue;
                }

                try {
                    const data = JSON.parse(content);
                    if (data.id && data.mainSource?.source) {
                        adventureDataList.push({
                            id: data.id,
                            src: data.mainSource.source,
                            name_en: data.displayName?.en || '',
                            name_zh: data.displayName?.zh || data.displayName?.en || ''
                        });
                    }
                } catch {
                    continue;
                }
            }
        }

        if (adventureDataList.length > 0) {
            const output = {
                type: 'adventure',
                data: adventureDataList
            };
            
            const outputPath = path.join(namelistDir, 'adventurelist.json');
            await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
            console.log(`已生成 adventurelist.json 文件：${outputPath}`);
            console.log(`[prepareData] adventure 完成 (${adventureDataList.length})`);
        }
    } catch (e) {
        console.error('[splitBooks] 生成 adventure namelist 失败:', e);
        if (e instanceof Error) {
            console.error('[splitBooks] 错误堆栈:', e.stack);
        }
    }
};

export const splitBooks = async () => {
    try {
        console.log('[splitBooks] 开始分割书籍和冒险');

        const outputDir = './output';

        // 从原始 books.json 和 adventures.json 中读取书籍和冒险列表
        const { en: enBooks, zh: zhBooks } = await loadBooksJson();
        const { en: enAdventures, zh: zhAdventures } = await loadAdventuresJson();

        // 创建一个映射，从 bookId 映射到原始数据（包含 contents）
        const bookContentsMap = new Map<string, any>();
        
        // 从原始 books.json 添加
        for (const book of [...enBooks, ...zhBooks]) {
            if (book.id && book.contents) {
                bookContentsMap.set(book.id, book);
            }
        }
        
        // 从原始 adventures.json 添加
        for (const adventure of [...enAdventures, ...zhAdventures]) {
            if (adventure.id && adventure.contents) {
                bookContentsMap.set(adventure.id, adventure);
            }
        }

        const bookIds = new Set<string>();
        const adventureIds = new Set<string>();

        // 从原始数据中收集书籍ID
        for (const book of [...enBooks, ...zhBooks]) {
            if (book.id) {
                bookIds.add(book.id);
            }
        }
        
        // 从原始数据中收集冒险ID
        for (const adventure of [...enAdventures, ...zhAdventures]) {
            if (adventure.id) {
                adventureIds.add(adventure.id);
            }
        }

        // 也检查生成的内容目录作为后备
        for (const dir of ['config/contents', 'output/contents/book', 'output/contents/adventure']) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const id = file.replace('.json', '');
                    if (dir.includes('/adventure')) {
                        adventureIds.add(id);
                    } else {
                        bookIds.add(id);
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // 处理全部出版物
        const testOnly = false;
        
        for (const contentDir of ['config/contents', 'output/contents/book', 'output/contents/adventure']) {
            try {
                const files = await fs.readdir(contentDir);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const id = file.replace('.json', '');
                    
                    if (testOnly && id !== 'XPHB') continue;
                    
                    const filePath = path.join(contentDir, file);

                    try {
                        const content = await fs.readFile(filePath, 'utf-8');
                        const bookData = JSON.parse(removeBOM(content));

                        // 优先使用原始数据中的 contents
                        const originalData = bookContentsMap.get(id);
                        if (originalData && originalData.contents) {
                            bookData.contents = originalData.contents;
                        }

                        const type = adventureIds.has(id) ? 'adventure' : 'book';
                        await processSingleBook(bookData, type, outputDir, filePath);
                    } catch (e) {
                        console.error(e);
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // 生成 adventure namelist
        await generateAdventureNameList(outputDir);
        
        // 打印章节映射统计
        // console.log('[splitBooks] 章节映射统计:');
        sectionTextIdMap.printStats();

        // console.log('[splitBooks] 完成');
    } catch (e) {
        console.error('[splitBooks] 致命错误:', e);
        if (e instanceof Error) {
            console.error('[splitBooks] 错误堆栈:', e.stack);
        }
        throw e;
    }
};

// 直接运行时的入口
if (import.meta.url === `file://${process.argv[1]}`) {
    splitBooks();
}
