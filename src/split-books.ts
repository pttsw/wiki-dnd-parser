import fs from 'fs/promises';
import path from 'path';
import config from './config.js';

const removeBOM = (content: string): string => {
    if (content.startsWith('\uFEFF')) {
        return content.slice(1);
    }
    return content;
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
        enData = JSON.parse(enContent).data || [];
       // console.log(`  成功加载英文 ${type} 数据: ${enPath}`);
    } catch (e) {
        console.log(`未找到英文 ${type} 数据: ${enPath}`);
    }

    try {
        const zhContent = await fs.readFile(zhPath, 'utf-8');
        zhData = JSON.parse(zhContent).data || [];
       // console.log(`  成功加载中文 ${type} 数据: ${zhPath}`);
    } catch (e) {
       // console.log(`未找到中文 ${type} 数据: ${zhPath}`);
    }

    return { zh: zhData, en: enData };
};

const extractEnNameFromEntry = (entry: any): string => {
    if (entry.ENG_name) return entry.ENG_name;
    if (entry.name) return entry.name;
    return '';
};

const extractZhNameFromEntry = (entry: any): string => {
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
        displayEn = `Appendix ${identifier}: ${enName}`;
        displayZh = `附录${identifier}：${zhName}`;
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
    zhData: any[]
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

        let enContent = sectionEn ? { entries: [...sectionEn.entries] } : null;
        let zhContent = sectionZh ? { entries: [...sectionZh.entries] } : null;

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

        const displayNameWithPrefix = getDisplayNameWithPrefix(enName, zhName, entry.ordinal);

        const fileData = {
            dataType,
            uid,
            id: finalId,
            textid: sectionId,
            source: bookId,
            page,
            type,
            displayName: {
                zh: displayNameWithPrefix.zh || null,
                en: displayNameWithPrefix.en || null,
            },
            zh: zhContent,
            en: enContent,
        };

        const preferredFileName = `${bookType}_1_${bookId}_1_${sectionId}.json`;
        const bookOutputDir = path.join(outputDir, bookType, bookId);
        await fs.mkdir(bookOutputDir, { recursive: true });
        const filePath = path.join(bookOutputDir, preferredFileName);

        await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
       // console.log(`  生成: ${filePath}`);

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
    zhData: any[]
) => {
    const sectionEn = sectionId ? findSectionById(enData, sectionId) : null;
    const sectionZh = sectionId ? findSectionById(zhData, sectionId) : null;

    const dataType = bookType;
    const uid = `${bookType}_${sectionId}|${bookId}`;
    const finalId = `${sectionId}|${bookId}`;
    const page = sectionEn?.page || sectionZh?.page || 0;
    const type = sectionEn?.type || sectionZh?.type || 'section';

    const enContent = { entries: enEntries };
    const zhContent = { entries: zhEntries };

    const displayNameWithPrefix = getDisplayNameWithPrefix(enName, zhName, ordinal);

    const fileData = {
        dataType,
        uid,
        id: finalId,
        source: bookId,
        page,
        type,
        displayName: {
            zh: displayNameWithPrefix.zh || null,
            en: displayNameWithPrefix.en || null,
        },
        zh: zhContent,
        en: enContent,
    };

    const preferredFileName = `${bookType}_1_${bookId}_1_${sectionId}.json`;
    const bookOutputDir = path.join(outputDir, bookType, bookId);
    await fs.mkdir(bookOutputDir, { recursive: true });
    const filePath = path.join(bookOutputDir, preferredFileName);

    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
   // console.log(`  生成: ${filePath}`);
};

const processSingleBook = async (
    bookData: any,
    bookType: 'book' | 'adventure',
    outputDir: string,
    contentPath: string
) => {
    const bookId = bookData.id;
   // console.log(`处理 ${bookType}: ${bookId}`);

    const bookContent = await loadBookContentFile(bookId, bookType);
    const nameToIdMap = buildNameToIdMap(bookContent.en || bookContent.zh || []);

    let contentData: any = null;
    try {
        const contentRaw = await fs.readFile(contentPath, 'utf-8');
        contentData = JSON.parse(removeBOM(contentRaw));
    } catch (e) {
        console.log(`[splitBooks] 未找到内容文件: ${contentPath}`);
        return;
    }

    if (!contentData.contents) {
        console.log(`[splitBooks] 内容文件缺少 contents: ${contentPath}`);
        return;
    }

    for (const entry of contentData.contents) {
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
                bookContent.zh || []
            );
        } else if (sectionId) {
            const processed = await processContentEntry(
                entry,
                bookId,
                bookType,
                outputDir,
                nameToIdMap,
                bookContent.en || [],
                bookContent.zh || []
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
                    bookContent.zh || []
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
                            bookContent.zh || []
                        );
                    } else {
                        const processed = await processContentEntry(
                            header,
                            bookId,
                            bookType,
                            outputDir,
                            nameToIdMap,
                            bookContent.en || [],
                            bookContent.zh || []
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
                                bookContent.zh || []
                            );
                        }
                    }
                }
            }
        }
    }
};

const main = async () => {
    try {
        console.log('[splitBooks] 开始分割书籍和冒险');

        const outputDir = './output';

        const bookIds = new Set<string>();
        const adventureIds = new Set<string>();

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

                        const type = adventureIds.has(id) ? 'adventure' : 'book';
                        await processSingleBook(bookData, type, outputDir, filePath);
                    } catch (e) {
                        console.log(`[splitBooks] 处理文件失败: ${filePath}`);
                        console.error(e);
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
            console.log('[splitBooks] 未找到 adventure 目录，跳过生成 namelist');
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

main();
