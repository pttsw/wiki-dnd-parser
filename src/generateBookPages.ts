import * as fs from 'fs/promises';
import * as path from 'path';

const numberToChinese = (num: number): string => {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const positions = ['', '十', '百', '千'];
    
    if (num === 0) return '零';
    if (num < 10) return digits[num];
    
    let result = '';
    let hasZero = false;
    
    const str = num.toString();
    const len = str.length;
    
    for (let i = 0; i < len; i++) {
        const digit = parseInt(str[i]);
        const pos = len - 1 - i;
        
        if (digit === 0) {
            hasZero = true;
        } else {
            if (hasZero) {
                result += '零';
                hasZero = false;
            }
            result += digits[digit] + positions[pos];
        }
    }
    
    if (result.startsWith('一十')) {
        result = result.substring(1);
    }
    
    return result;
};

interface PageData {
    id: string;
    source: string;
    page: number;
    type: string;
    identifier?: number;
    displayName?: {
        zh?: string | null;
        en?: string | null;
    };
    zh?: {
        type?: string;
        name?: string;
        title?: string;
        ENG_name?: string;
        ENG_title?: string;
    };
    en?: {
        type?: string;
        name?: string;
        title?: string;
    };
    ordinal?: {
        type?: string;
        identifier?: number | string;
    };
    zh_name?: string;
    name?: string;
    ENG_name?: string;
}

interface ChapterHierarchy {
    id: string;
    nameZh?: string;
    nameEn?: string;
    ordinal?: {
        type?: string;
        identifier?: number | string;
    };
}

interface BookContentConfig {
    id: string;
    name?: string;
    zh_name?: string;
    displayName?: {
        zh?: string;
        en?: string;
    };
    contents?: Array<{
        id: string;
        name?: string;
        zh_name?: string;
        displayName?: {
            zh?: string;
            en?: string;
        };
        contents?: Array<any>;
        headers?: Array<any>;
    }>;
}

const bookConfigs: Map<string, BookContentConfig> = new Map();
const writtenFiles: Map<string, string> = new Map();

const loadBookConfigs = async (): Promise<void> => {
    try {
        const outputContentsDir = './output/contents';
        const types = ['book', 'adventure'];
        for (const type of types) {
            const dir = path.join(outputContentsDir, type);
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const filePath = path.join(dir, file);
                        let content = await fs.readFile(filePath, 'utf-8');
                        if (content.charCodeAt(0) === 0xFEFF) {
                            content = content.slice(1);
                        }
                        const config = JSON.parse(content);
                        if (config.id) {
                            bookConfigs.set(config.id, config);
                        }
                    }
                }
            } catch (e) {
                console.error(`目录不存在或无法读取: ${dir}, 错误: ${e}`);
            }
        }
    } catch (error) {
        console.error(`加载输出配置目录失败: ${error}`);
    }

    const configDir = './config/contents';
    try {
        const files = await fs.readdir(configDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(configDir, file);
                let content = await fs.readFile(filePath, 'utf-8');
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                const config = JSON.parse(content);
                bookConfigs.set(config.id, config);
            }
        }
    } catch (error) {
        console.error(`加载配置目录失败: ${error}`);
    }

    console.error(`配置加载完成，共 ${bookConfigs.size} 个配置`);
};

const getParentChapters = (bookId: string, pageId: string): ChapterHierarchy[] => {
    const config = bookConfigs.get(bookId);
    if (!config || !config.contents) {
        return [];
    }

    const pathArray: ChapterHierarchy[] = [];
    const findInContents = (contents: any[], targetId: string): boolean => {
        for (const item of contents) {
            if (item.id === targetId) {
                return true;
            }
            const children = item.contents || item.headers;
            if (children && Array.isArray(children)) {
                pathArray.push({
                    id: item.id,
                    nameZh: item.displayName?.zh || item.zh_name || item.name,
                    nameEn: item.displayName?.en || item.name,
                    ordinal: item.ordinal,
                });
                if (findInContents(children, targetId)) {
                    return true;
                }
                pathArray.pop();
            }
        }
        return false;
    };

    findInContents(config.contents, pageId);
    return pathArray;
};

const isTopLevelChapter = (bookId: string, pageId: string): boolean => {
    const config = bookConfigs.get(bookId);
    if (!config || !config.contents) {
        return true;
    }
    return config.contents.some(item => item.id === pageId);
};

const getBookName = (bookId: string): { zh?: string; en?: string } => {
    const config = bookConfigs.get(bookId);
    if (config) {
        return {
            zh: config.displayName?.zh || config.zh_name || config.name,
            en: config.displayName?.en || config.name,
        };
    }
    return { zh: bookId, en: bookId };
};

const getPageNameZh = (pageData: PageData): string => {
    const nameZh = pageData.displayName?.zh || pageData.zh?.title || pageData.zh?.name || pageData.zh_name;
    if (nameZh) return nameZh;
    const nameEn = pageData.displayName?.en || pageData.en?.title || pageData.en?.name || pageData.name;
    return nameEn || pageData.id.split('|')[0];
};

const getPageNameEn = (pageData: PageData): string => {
    const nameEn = pageData.displayName?.en || pageData.en?.title || pageData.en?.name || pageData.ENG_name || pageData.name;
    if (nameEn) return nameEn;
    const nameZh = pageData.displayName?.zh || pageData.zh?.title || pageData.zh?.name || pageData.zh_name;
    return nameZh || pageData.id.split('|')[0];
};

const buildParentPrefix = (ordinal?: { type?: string; identifier?: number | string }, isChinese: boolean = true): string => {
    if (!ordinal?.type || ordinal.identifier === undefined) {
        return '';
    }

    const type = ordinal.type;
    const identifier = ordinal.identifier;

    if (type === 'chapter') {
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            return isChinese ? `第${chineseNum}章：` : `Chapter ${identifier}: `;
        } else if (identifier !== null && identifier !== '') {
            return isChinese ? `附录${identifier}：` : `Appendix ${identifier}: `;
        }
    } else if (type === 'appendix') {
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            return isChinese ? `附录${chineseNum}：` : `Appendix ${identifier}: `;
        } else if (identifier !== null && identifier !== '') {
            return isChinese ? `附录${identifier}：` : `Appendix ${identifier}: `;
        }
    }

    return '';
};

const buildPagePrefix = (pageData: PageData): { zhPrefix: string; enPrefix: string } => {
    let zhPrefix = '';
    let enPrefix = '';
    const type = pageData.type;
    const identifier = pageData.identifier;

    if (type === 'chapter' && identifier !== undefined) {
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            zhPrefix = `第${chineseNum}章：`;
            enPrefix = `Chapter ${identifier}: `;
        } else if (identifier !== null && identifier !== '') {
            zhPrefix = `附录${identifier}：`;
            enPrefix = `Appendix ${identifier}: `;
        }
    } else if (type === 'appendix' && identifier !== undefined) {
        if (typeof identifier === 'number') {
            const chineseNum = numberToChinese(identifier);
            zhPrefix = `附录${chineseNum}：`;
            enPrefix = `Appendix ${identifier}: `;
        } else if (identifier !== null && identifier !== '') {
            zhPrefix = `附录${identifier}：`;
            enPrefix = `Appendix ${identifier}: `;
        }
    }

    return { zhPrefix, enPrefix };
};

const sanitizeFileSegment = (value: string): string => {
    return value.replace(/[\\/:*?"<>|]/g, '_').trim();
};

const writePage = async (
    dir: string,
    title: string,
    content: string,
    bookId: string,
    bookNameZh: string,
    bookNameEn: string,
    isZh: boolean,
    isAdventure: boolean,
    pageId: string,
    pageNameZh: string,
    pageNameEn: string
): Promise<boolean> => {
    const categoryFolder = isAdventure ? '模组' : '扩展';
    const bookName = isZh ? bookNameZh : bookNameEn;
    
    const targetDir = path.join(dir, categoryFolder, sanitizeFileSegment(bookName));
    await fs.mkdir(targetDir, { recursive: true });

    const filePath = path.join(targetDir, `${sanitizeFileSegment(title)}.wiki`);
    const normalizedContent = `${content}\n`;
    const existing = writtenFiles.get(filePath);

    if (existing !== undefined) {
        if (existing !== normalizedContent) {
            console.error(`页面标题冲突，保留首个文件：${filePath}`);
        }
    } else {
        await fs.writeFile(filePath, normalizedContent, 'utf-8');
        writtenFiles.set(filePath, normalizedContent);
    }

    const finalBookNameZh = bookNameZh || bookNameEn;
    const finalBookNameEn = bookNameEn || bookNameZh;
    const escapedTitle = title.replace(/_1_/g, '/');
    
    let redirectTarget = '';
    if (pageNameZh) {
        redirectTarget = `${sanitizeFileSegment(finalBookNameZh)}/${escapedTitle}`;
    } else if (pageNameEn) {
        redirectTarget = `${sanitizeFileSegment(finalBookNameEn)}/${escapedTitle}`;
    }

    if (redirectTarget) {
        const idDir = path.join(dir, categoryFolder, sanitizeFileSegment(bookId));
        await fs.mkdir(idDir, { recursive: true });
        
        const idFilePath = path.join(idDir, `${sanitizeFileSegment(pageId)}.wiki`);
        const idContent = `#重定向[[${redirectTarget}]]\n`;
        const existingIdFile = writtenFiles.get(idFilePath);
        
        if (existingIdFile === undefined) {
            await fs.writeFile(idFilePath, idContent, 'utf-8');
            writtenFiles.set(idFilePath, idContent);
        }
    }

    return true;
};

const processBook = async (bookDir: string, bookId: string, isAdventure: boolean = false): Promise<{ zhCount: number; enCount: number }> => {
    let zhCount = 0;
    let enCount = 0;

    try {
        const files = await fs.readdir(bookDir);
        const bookName = getBookName(bookId);

        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(bookDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const pageData = JSON.parse(content) as PageData;

                const pageId = pageData.id.split('|')[0];
                const isTopLevel = isTopLevelChapter(bookId, pageId);
                const parentChapters = getParentChapters(bookId, pageId);

                const { zhPrefix, enPrefix } = buildPagePrefix(pageData);
                const baseNameZh = getPageNameZh(pageData);
                const baseNameEn = getPageNameEn(pageData);

                let fullNameZh = zhPrefix + baseNameZh;
                let fullNameEn = enPrefix + baseNameEn;

                if (!isTopLevel && parentChapters.length > 0) {
                    const parentPartsZh: string[] = [];
                    const parentPartsEn: string[] = [];

                    for (const parent of parentChapters) {
                        const parentZhPrefix = buildParentPrefix(parent.ordinal);
                        const parentEnPrefix = buildParentPrefix(parent.ordinal, false);
                        
                        if (parent.nameZh) {
                            parentPartsZh.push(parentZhPrefix + parent.nameZh);
                        }
                        if (parent.nameEn) {
                            parentPartsEn.push(parentEnPrefix + parent.nameEn);
                        }
                    }

                    fullNameZh = [...parentPartsZh, fullNameZh].join('_1_');
                    fullNameEn = [...parentPartsEn, fullNameEn].join('_1_');
                }

                if (pageData.zh || pageData.displayName?.zh) {
                    const zhContent = `{{内容|${pageId}|${bookId}|zh}}`;
                    if (await writePage(
                        './output_page',
                        fullNameZh,
                        zhContent,
                        bookId,
                        bookName.zh || bookId,
                        bookName.en || bookId,
                        true,
                        isAdventure,
                        pageId,
                        baseNameZh,
                        baseNameEn
                    )) {
                        zhCount++;
                    }
                }

                if (pageData.en || pageData.displayName?.en) {
                    const enContent = `{{内容|${pageId}|${bookId}|en}}`;
                    if (await writePage(
                        './output_page',
                        fullNameEn,
                        enContent,
                        bookId,
                        bookName.zh || bookId,
                        bookName.en || bookId,
                        false,
                        isAdventure,
                        pageId,
                        baseNameZh,
                        baseNameEn
                    )) {
                        enCount++;
                    }
                }
            }
        }
    } catch (error) {
        console.error(`处理书籍 ${bookId} 失败: ${error}`);
    }

    return { zhCount, enCount };
};

const processAdventure = async (adventureDir: string, bookId: string): Promise<{ zhCount: number; enCount: number }> => {
    return processBook(adventureDir, bookId, true);
};

const generateAll = async (): Promise<{
    totalZh: number;
    totalEn: number;
    processedBooks: number;
    processedAdventures: number;
}> => {
    let totalZh = 0;
    let totalEn = 0;
    let processedBooks = 0;
    let processedAdventures = 0;

    console.error('开始加载配置...');
    await loadBookConfigs();
    console.error('配置加载完成！');

    const booksDir = './output/book';
    try {
        const bookDirs = await fs.readdir(booksDir);
        for (const bookDirName of bookDirs) {
            const bookDir = path.join(booksDir, bookDirName);
            try {
                const stat = await fs.stat(bookDir);
                if (stat.isDirectory()) {
                    const bookId = bookDirName;
                    const { zhCount, enCount } = await processBook(bookDir, bookId);
                    totalZh += zhCount;
                    totalEn += enCount;
                    processedBooks++;
                }
            } catch (error) {
                console.error(`处理书籍目录失败: ${error}`);
            }
        }
    } catch (error) {
        console.error(`读取书籍目录失败: ${error}`);
    }

    const adventuresDir = './output/adventure';
    try {
        const adventureDirs = await fs.readdir(adventuresDir);
        for (const adventureDirName of adventureDirs) {
            const adventureDir = path.join(adventuresDir, adventureDirName);
            try {
                const stat = await fs.stat(adventureDir);
                if (stat.isDirectory()) {
                    const bookId = adventureDirName;
                    const { zhCount, enCount } = await processBook(adventureDir, bookId, true);
                    totalZh += zhCount;
                    totalEn += enCount;
                    processedAdventures++;
                }
            } catch (error) {
                console.error(`处理冒险目录失败: ${error}`);
            }
        }
    } catch (error) {
        console.error(`读取冒险目录失败: ${error}`);
    }

    return {
        totalZh,
        totalEn,
        processedBooks,
        processedAdventures,
    };
};

const main = async () => {
    console.log('开始生成书籍和冒险页面...');
    try {
        const result = await generateAll();
        console.log(`生成完成！中文: ${result.totalZh}，英文: ${result.totalEn}`);
        console.log(`处理书籍: ${result.processedBooks}，处理冒险: ${result.processedAdventures}`);
    } catch (error) {
        console.error('生成页面失败:', error);
        process.exit(1);
    }
};

main();
