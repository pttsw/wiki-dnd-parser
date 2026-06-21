import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { escapeFileName, sectionTextIdMap } from './exporters/shared.js';
import { tagParser } from './contentGen.js';
import { runParallel } from './parallelUtils.js';

interface TextEntry {
    id: string;
    name_en: string;
    name_zh: string;
    link: string;
}

const textEntriesByBook: Record<string, TextEntry[]> = {};

const addTextEntry = (bookId: string, id: string, name_en: string, name_zh: string, link: string) => {
    if (!textEntriesByBook[bookId]) {
        textEntriesByBook[bookId] = [];
    }
    textEntriesByBook[bookId].push({ id, name_en, name_zh, link });
};

const removeBOM = (content: string): string => {
    if (content.startsWith('\uFEFF')) {
        return content.slice(1);
    }
    return content;
};

const processBookTags = (obj: any, isZh: boolean = true): any => {
    if (typeof obj === 'string') {
        return tagParser.parse(obj, isZh);
    } else if (typeof obj === 'number') {
        return obj;
    } else if (Array.isArray(obj)) {
        return obj.map(item => processBookTags(item, isZh));
    } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {};
        for (const key of Object.keys(obj)) {
            result[key] = processBookTags(obj[key], isZh);
        }
        return result;
    }
    return obj;
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

const processEntriesWithTitleFork = (entries: any[], depth: number = -1, parentType?: string): any[] => {
    if (!Array.isArray(entries)) return entries;
    
    return entries.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            return entry;
        }
        
        const processedEntry = { ...entry };
        const currentType = processedEntry.type;
        
        const entryConfig = ENTRIES_WITH_ENUMERATED_TITLES_LOOKUP[currentType];
        
        if (currentType === 'entries') {
            if (depth < 2 && (processedEntry.name != null || processedEntry.title != null)) {
                processedEntry.title_fork = depth + 2;
                if ('ENG_name' in processedEntry) {
                    processedEntry.ENG_title = processedEntry.ENG_name;
                    delete processedEntry.ENG_name;
                }
                if ('name' in processedEntry) {
                    processedEntry.title = processedEntry.name;
                    delete processedEntry.name;
                }
            }
        } else if (entryConfig) {
            let titleDepth = depth;
            if (entryConfig?.depth !== undefined) {
                titleDepth = entryConfig.depth;
            } else if (entryConfig?.depthIncrement) {
                titleDepth = depth + 1;
            } else if (currentType === 'section') {
                titleDepth = -1;
            }
            titleDepth = Math.min(Math.max(titleDepth, -1), 2);
            
            if (titleDepth < 2 && processedEntry.name != null) {
                if ('ENG_name' in processedEntry) {
                    processedEntry.ENG_title = processedEntry.ENG_name;
                    delete processedEntry.ENG_name;
                }
                if ('name' in processedEntry) {
                    processedEntry.title = processedEntry.name;
                    delete processedEntry.name;
                }
                processedEntry.title_fork = titleDepth + 2;
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
            } else if (currentType === 'entries') {
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

    // console.log(`[loadBookContentFile] 加载 ${type} ${bookId}:`);
    // console.log(`[loadBookContentFile] 英文路径: ${enPath}`);
    // console.log(`[loadBookContentFile] 中文路径: ${zhPath}`);

    let enData: any[] | null = null;
    let zhData: any[] | null = null;

    try {
        const enContent = await fs.readFile(enPath, 'utf-8');
        const parsed = JSON.parse(enContent).data;
        enData = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        // console.log(`[loadBookContentFile] 英文数据加载成功，共 ${enData.length} 条`);
    } catch (e) {
        // console.log(`[loadBookContentFile] 英文数据加载失败: ${e}`);
    }

    try {
        const zhContent = await fs.readFile(zhPath, 'utf-8');
        const parsed = JSON.parse(zhContent).data;
        zhData = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        // console.log(`[loadBookContentFile] 中文数据加载成功，共 ${zhData.length} 条`);
    } catch (e) {
        // console.log(`[loadBookContentFile] 中文数据加载失败: ${e}`);
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

const hasChapterPrefixZh = (name: string): boolean => {
    return name.startsWith('第') && name.includes('章');
};

const hasAppendixPrefixZh = (name: string): boolean => {
    return name.startsWith('附录');
};

const hasChapterPrefixEn = (name: string): boolean => {
    return name.startsWith('Chapter');
};

const hasAppendixPrefixEn = (name: string): boolean => {
    return name.startsWith('Appendix');
};

const buildPagePrefix = (type: string | undefined, identifier: number | string | undefined, nameZh: string, nameEn: string): { zhPrefix: string; enPrefix: string } => {
    let zhPrefix = '';
    let enPrefix = '';

    if (type === 'chapter' && identifier !== undefined) {
        const parsedIdentifier = typeof identifier === 'string' ? parseInt(identifier, 10) : identifier;
        const isNumeric = typeof parsedIdentifier === 'number' && !isNaN(parsedIdentifier);
        
        if (isNumeric) {
            if (parsedIdentifier === 0) {
                return { zhPrefix: '', enPrefix: '' };
            }
            if (hasChapterPrefixZh(nameZh)) {
                zhPrefix = '';
            } else {
                const chineseNum = numberToChinese(parsedIdentifier);
                zhPrefix = `第${chineseNum}章：`;
            }
            if (hasAppendixPrefixEn(nameEn)) {
                enPrefix = '';
            } else {
                enPrefix = `Chapter ${parsedIdentifier}: `;
            }
        } else if (identifier !== null && identifier !== '') {
            if (nameZh.startsWith('附录')) {
                zhPrefix = '';
            } else {
                zhPrefix = `附录${identifier}：`;
            }
            if (hasAppendixPrefixEn(nameEn)) {
                enPrefix = '';
            } else {
                enPrefix = `Appendix ${identifier}: `;
            }
        }
    } else if (type === 'appendix' && identifier !== undefined) {
        const parsedIdentifier = typeof identifier === 'string' ? parseInt(identifier, 10) : identifier;
        const isNumeric = typeof parsedIdentifier === 'number' && !isNaN(parsedIdentifier);
        
        if (isNumeric) {
            if (parsedIdentifier === 0) {
                return { zhPrefix: '', enPrefix: '' };
            }
            if (hasAppendixPrefixZh(nameZh)) {
                zhPrefix = '';
            } else {
                const chineseNum = numberToChinese(parsedIdentifier);
                zhPrefix = `附录${chineseNum}：`;
            }
            if (hasAppendixPrefixEn(nameEn)) {
                enPrefix = '';
            } else {
                enPrefix = `Appendix ${parsedIdentifier}: `;
            }
        } else if (identifier !== null && identifier !== '') {
            if (hasAppendixPrefixZh(nameZh)) {
                zhPrefix = '';
            } else {
                zhPrefix = `附录${identifier}：`;
            }
            if (hasAppendixPrefixEn(nameEn)) {
                enPrefix = '';
            } else {
                enPrefix = `Appendix ${identifier}: `;
            }
        }
    }

    return { zhPrefix, enPrefix };
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

const collectSectionTitles = (entry: any, bookId: string, zhPageTitle: string, enPageTitle: string): void => {
    if (!entry || typeof entry !== 'object') return;
    
    if (entry.name && typeof entry.name === 'string') {
        sectionTextIdMap.setSectionTitleToPageTitle(bookId, entry.name, zhPageTitle, enPageTitle);
    }
    
    if (entry.title && typeof entry.title === 'string') {
        sectionTextIdMap.setSectionTitleToPageTitle(bookId, entry.title, zhPageTitle, enPageTitle);
    }
    
    if (Array.isArray(entry.entries)) {
        for (const item of entry.entries) {
            collectSectionTitles(item, bookId, zhPageTitle, enPageTitle);
        }
    }
};

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

interface ProcessedSection {
    id: string;
    subpageId?: string;
    zhEntries: any[];
    enEntries: any[];
}

const processContentEntry = async (
    entry: any,
    bookId: string,
    bookType: 'book' | 'adventure',
    outputDir: string,
    nameToIdMap: Map<string, string>,
    enData: any[],
    zhData: any[],
    chapterIndex?: number,
    parentZhTitle: string = '',
    parentEnTitle: string = ''
): Promise<ProcessedSection | null> => {
    
    const enName = extractEnNameFromEntry(entry);
    const zhName = extractZhNameFromEntry(entry);
    const nameForId = enName || zhName;
    let sectionId = entry.id || '';

    if (!sectionId && nameForId) {
        sectionId = nameToIdMap.get(nameForId) || nameToIdMap.get(removeChapterPrefix(nameForId)) || '';
    }

    if (!sectionId) {
        return null;
    }

    const sectionEn = sectionId ? findSectionById(enData, sectionId) : null;
    const sectionZh = sectionId ? findSectionById(zhData, sectionId) : null;

    // console.log(`[processContentEntry] 处理章节 ${sectionId}|${bookId}:`);
    // console.log(`[processContentEntry] sectionEn 找到: ${sectionEn !== null}`);
    // console.log(`[processContentEntry] sectionZh 找到: ${sectionZh !== null}`);

    const finalId = `${sectionId}|${bookId}`;

    if (entry.alonepage) {
        const dataType = "text";
        const uid = `${bookType}_${sectionId}|${bookId}`;
        const page = sectionEn?.page || sectionZh?.page || 0;
        const type = sectionEn?.type || sectionZh?.type || 'section';

        let enContent = sectionEn ? { ...sectionEn, entries: [...sectionEn.entries] } : { entries: [] };
        const ordinal = entry.ordinal || {};
        const { zhPrefix, enPrefix } = buildPagePrefix(ordinal.type, ordinal.identifier, zhName, enName);
        let fullZhTitle = zhPrefix + zhName;
        let fullEnTitle = enPrefix + enName;
        
        if (parentZhTitle && fullZhTitle) {
            fullZhTitle = `${parentZhTitle}/${fullZhTitle}`;
        }
        if (parentEnTitle && fullEnTitle) {
            fullEnTitle = `${parentEnTitle}/${fullEnTitle}`;
        }
        
        let zhContent = sectionZh ? { ...sectionZh, entries: [...sectionZh.entries] } : { entries: [] };

        const headerSubpageMap = new Map<string, string>();

        if (entry.headers && Array.isArray(entry.headers)) {
            // console.log(`[processContentEntry] 章节 ${sectionId} 有 ${entry.headers.length} 个子章节`);
            for (const header of entry.headers) {
                // console.log(`[processContentEntry] 子章节 ID: ${header.id}, alonepage: ${header.alonepage}`);
                if (header.alonepage) {
                    const headerProcessed = await processContentEntry(
                        header,
                        bookId,
                        bookType,
                        outputDir,
                        nameToIdMap,
                        enData,
                        zhData,
                        undefined,
                        fullZhTitle,
                        fullEnTitle
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
        
        if (zhContent) {
            collectSectionTitles(zhContent, bookId, fullZhTitle, fullEnTitle);
        }
        if (enContent) {
            collectSectionTitles(enContent, bookId, fullZhTitle, fullEnTitle);
        }
        
        const processedZhContent = processBookTags(zhContent, true);
        const processedEnContent = processBookTags(enContent, false);

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
            zh: processedZhContent,
            en: processedEnContent,
        };

        const preferredFileName = `${escapeFileName(sectionId)}.json`;
        const bookOutputDir = path.join(outputDir, bookType, bookId);
        await fs.mkdir(bookOutputDir, { recursive: true });
        const filePath = path.join(bookOutputDir, preferredFileName);

        await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');

        collectTextEntriesFromSection(bookId, sectionId, zhName, enName, zhContent?.entries || [], enContent?.entries || [], fullZhTitle || fullEnTitle || sectionId);

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

const collectTextEntriesFromSection = (
    bookId: string,
    sectionId: string,
    zhName: string,
    enName: string,
    zhEntries: any[],
    enEntries: any[],
    pageTitle: string
) => {
    addTextEntry(bookId, sectionId, enName, zhName, pageTitle);

    const collectFromEntries = (entries: any[], parentId: string = '') => {
        if (!Array.isArray(entries)) return;

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;

            const entryId = entry.id || '';
            const entryEnName = entry.ENG_name || entry.name || '';
            const entryZhName = entry.title || entry.name || '';

            if (entryId) {
                const fullId = parentId ? `${parentId}.${entryId}` : entryId;
                addTextEntry(bookId, fullId, entryEnName, entryZhName, pageTitle);
            }

            if (Array.isArray(entry.entries)) {
                const newParentId = entryId ? (parentId ? `${parentId}.${entryId}` : entryId) : parentId;
                collectFromEntries(entry.entries, newParentId);
            }
        }
    };

    collectFromEntries(zhEntries);
    collectFromEntries(enEntries);
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

    const dataType = "text";
    const uid = `${bookType}_${sectionId}|${bookId}`;
    const finalId = `${sectionId}|${bookId}`;
    const page = sectionEn?.page || sectionZh?.page || 0;
    const type = sectionEn?.type || sectionZh?.type || 'section';

    const enContent = { entries: enEntries };
    const zhContent = { entries: zhEntries };

    const processedZhContent = processBookTags(zhContent);
    const processedEnContent = processBookTags(enContent);

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
        zh: processedZhContent,
        en: processedEnContent,
    };

    const preferredFileName = `${escapeFileName(sectionId)}.json`;
    const bookOutputDir = path.join(outputDir, bookType, bookId);
    await fs.mkdir(bookOutputDir, { recursive: true });
    const filePath = path.join(bookOutputDir, preferredFileName);

    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');

    const pageTitle = zhName || enName || sectionId;
    collectTextEntriesFromSection(bookId, sectionId, zhName, enName, zhEntries, enEntries, pageTitle);
};

const buildFullSectionTitleMap = async (bookId: string, bookContent: { zh: any[] | null; en: any[] | null }, contents: any[]): Promise<void> => {
    const processEntry = (entry: any, parentZhTitle: string, parentEnTitle: string) => {
        if (!entry || typeof entry !== 'object') return;
        
        const enName = extractEnNameFromEntry(entry);
        const zhName = extractZhNameFromEntry(entry);
        const sectionId = entry.id || '';
        
        const ordinal = entry.ordinal || {};
        const { zhPrefix, enPrefix } = buildPagePrefix(ordinal.type, ordinal.identifier, zhName, enName);
        
        let fullNameZh = zhPrefix + zhName;
        let fullNameEn = enPrefix + enName;
        
        if (parentZhTitle && fullNameZh) {
            fullNameZh = `${parentZhTitle}/${fullNameZh}`;
        }
        if (parentEnTitle && fullNameEn) {
            fullNameEn = `${parentEnTitle}/${fullNameEn}`;
        }
        
        const isChapter = ordinal.type === 'chapter';
        const isAlonePage = entry.alonepage === true;
        
        if ((isChapter || isAlonePage) && sectionId) {
            const sectionZh = findSectionById(bookContent.zh || [], sectionId);
            const sectionEn = findSectionById(bookContent.en || [], sectionId);
            
            if (sectionZh) {
                collectSectionTitles(sectionZh, bookId, fullNameZh, fullNameEn);
            }
            if (sectionEn && (!sectionZh || JSON.stringify(sectionZh) !== JSON.stringify(sectionEn))) {
                collectSectionTitles(sectionEn, bookId, fullNameZh, fullNameEn);
            }
        }
        
        if (entry.headers && Array.isArray(entry.headers)) {
            for (const header of entry.headers) {
                processEntry(header, fullNameZh, fullNameEn);
            }
        }
    };
    
    for (const entry of contents) {
        processEntry(entry, '', '');
    }
};

const processSingleBook = async (
    bookData: any,
    bookType: 'book' | 'adventure',
    outputDir: string,
    contentPath: string,
    bookContentsMap: Map<string, any>
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

    const originalData = bookContentsMap.get(bookId);
    if (originalData && originalData.contents) {
        contentData.contents = originalData.contents;
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

        if (sectionId) {
            sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, enName);
            if (zhName && zhName !== enName) {
                sectionTextIdMap.addMapping(bookId, sectionId, chapterIndex, zhName);
            }
            
            const { zhPrefix, enPrefix } = buildPagePrefix(entry.ordinal?.type, entry.ordinal?.identifier, zhName, enName);
            const fullNameZh = zhPrefix + zhName;
            const fullNameEn = enPrefix + enName;
            sectionTextIdMap.setPageTitle(bookId, chapterIndex, fullNameZh, fullNameEn);

            const currentSection = findSectionById(bookContent.zh || [], sectionId) || findSectionById(bookContent.en || [], sectionId);
            
            if (currentSection) {
                collectSectionTitles(currentSection, bookId, fullNameZh, fullNameEn);
            }

            if (entry.headers && Array.isArray(entry.headers)) {
                // console.log(`[processSingleBook] 章节 ${entry.id} 有 ${entry.headers.length} 个子章节`);
                for (const header of entry.headers) {
                    const headerEnName = extractEnNameFromEntry(header);
                    const headerZhName = extractZhNameFromEntry(header);
                    const headerSectionId = header.id || '';
                    // console.log(`[processSingleBook] 子章节: ${headerSectionId}, alonepage: ${header.alonepage}`);

                    if (headerSectionId) {
                        sectionTextIdMap.addMapping(bookId, headerSectionId, chapterIndex, headerEnName);
                        if (headerZhName && headerZhName !== headerEnName) {
                            sectionTextIdMap.addMapping(bookId, headerSectionId, chapterIndex, headerZhName);
                        }
                        
                        const headerOrdinal = header.ordinal || {};
                        const { zhPrefix: headerZhPrefix, enPrefix: headerEnPrefix } = buildPagePrefix(
                            headerOrdinal?.type, 
                            headerOrdinal?.identifier, 
                            headerZhName, 
                            headerEnName
                        );
                        const headerFullNameZh = `${fullNameZh}/${headerZhPrefix}${headerZhName}`;
                        const headerFullNameEn = `${fullNameEn}/${headerEnPrefix}${headerEnName}`;
                        sectionTextIdMap.setSubpageTitle(bookId, chapterIndex, headerZhName || headerEnName || '', headerFullNameZh, headerFullNameEn);
                        
                        const headerSection = findSectionById(bookContent.zh || [], headerSectionId) || findSectionById(bookContent.en || [], headerSectionId);
                        if (headerSection) {
                            collectSectionTitles(headerSection, bookId, headerFullNameZh, headerFullNameEn);
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
                                chapterIndex,
                                fullNameZh,
                                fullNameEn
                            );
                        } else {
                            await processContentEntry(
                                header,
                                bookId,
                                bookType,
                                outputDir,
                                nameToIdMap,
                                bookContent.en || [],
                                bookContent.zh || [],
                                chapterIndex,
                                fullNameZh,
                                fullNameEn
                            );
                        }
                    }
                }
            }

            if (entry.alonepage) {
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
            } else {
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
            }
        } else {
            if (entry.headers && Array.isArray(entry.headers)) {
                for (const header of entry.headers) {
                    const headerSectionId = header.id || '';
                    if (!headerSectionId) continue;

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
                                extractEnNameFromEntry(header),
                                extractZhNameFromEntry(header),
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

    await buildFullSectionTitleMap(bookId, bookContent, contentData.contents);
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

const generateTextNameList = async (outputDir: string) => {
    try {
        console.log('[splitBooks] 开始生成 textnamelist.json');

        const namelistDir = path.join(outputDir, 'namelist');
        await fs.mkdir(namelistDir, { recursive: true });

        const output = {
            type: 'text',
            data: textEntriesByBook
        };

        const outputPath = path.join(namelistDir, 'textnamelist.json');
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        console.log(`[splitBooks] 已生成 textnamelist.json 文件：${outputPath}`);

        let totalEntries = 0;
        for (const bookId of Object.keys(textEntriesByBook)) {
            totalEntries += textEntriesByBook[bookId].length;
        }
        console.log(`[splitBooks] textnamelist 完成 (${Object.keys(textEntriesByBook).length} 个出版物，${totalEntries} 个条目)`);
    } catch (e) {
        console.error('[splitBooks] 生成 textnamelist.json 失败:', e);
        if (e instanceof Error) {
            console.error('[splitBooks] 错误堆栈:', e.stack);
        }
    }
};

export const splitBooks = async () => {
    try {
        console.log('[splitBooks] 开始分割书籍和冒险');

        const outputDir = './output';

        const [{ en: enBooks, zh: zhBooks }, { en: enAdventures, zh: zhAdventures }] = await Promise.all([
            loadBooksJson(),
            loadAdventuresJson()
        ]);

        const bookContentsMap = new Map<string, any>();
        
        for (const book of [...enBooks, ...zhBooks]) {
            if (book.id && book.contents) {
                bookContentsMap.set(book.id, book);
            }
        }
        
        for (const adventure of [...enAdventures, ...zhAdventures]) {
            if (adventure.id && adventure.contents) {
                bookContentsMap.set(adventure.id, adventure);
            }
        }

        const bookIds = new Set<string>();
        const adventureIds = new Set<string>();

        for (const book of [...enBooks, ...zhBooks]) {
            if (book.id) {
                bookIds.add(book.id);
            }
        }

        for (const adventure of [...enAdventures, ...zhAdventures]) {
            if (adventure.id) {
                adventureIds.add(adventure.id);
            }
        }

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

        const tasks: Array<{ id: string; filePath: string; type: 'book' | 'adventure' }> = [];

        for (const contentDir of ['config/contents', 'output/contents/book', 'output/contents/adventure']) {
            try {
                const files = await fs.readdir(contentDir);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    const id = file.replace('.json', '');
                    const filePath = path.join(contentDir, file);
                    const type = adventureIds.has(id) ? 'adventure' : 'book';
                    tasks.push({ id, filePath, type });
                }
            } catch (e) {
                continue;
            }
        }

        console.log(`[splitBooks] 发现 ${tasks.length} 个出版物需要处理，开始处理...`);

        for (const task of tasks) {
            try {
                const content = await fs.readFile(task.filePath, 'utf-8');
                const bookData = JSON.parse(removeBOM(content));
                const originalData = bookContentsMap.get(task.id);
                if (originalData && originalData.contents) {
                    bookData.contents = originalData.contents;
                }
                await processSingleBook(bookData, task.type, outputDir, task.filePath, bookContentsMap);
            } catch (e) {
                console.error(`[splitBooks] 处理 ${task.id} 失败:`, e);
            }
        }

        await generateAdventureNameList(outputDir);

        await generateTextNameList(outputDir);
        
        sectionTextIdMap.printStats();

    } catch (e) {
        console.error('[splitBooks] 致命错误:', e);
        if (e instanceof Error) {
            console.error('[splitBooks] 错误堆栈:', e.stack);
        }
        throw e;
    }
};

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith('/split-books.ts')) {
    splitBooks();
}
