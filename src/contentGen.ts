import { parse, join } from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import { sectionTextIdMap } from './exporters/shared.js';
import type {
    ParaghaphInset,
    ParagraphCell,
    ParagraphContentTypes,
    ParagraphEntries,
    ParagraphHref,
    ParagraphImage,
    ParagraphInsetReadaloud,
    ParagraphInline,
    ParagraphLink,
    ParagraphGroup,
    ParagraphList,
    ParagraphListItem,
    ParagraphQuote,
    ParagraphSection,
    ParagraphStatblockInline,
    ParagraphTable,
} from './types/typography';

interface TagEntry {
    tagName: string;
    param: string | null;
}

interface SpellNameEntry {
    id: string;
    src: string;
    name_en: string;
    name_zh: string;
}

const spellNameMap: Map<string, string> = new Map();

const loadSpellNameMap = () => {
    try {
        const filePath = './output/namelist/spellnamelist.json';
        if (fsSync.existsSync(filePath)) {
            const content = fsSync.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            if (data.data && Array.isArray(data.data)) {
                for (const entry of data.data as SpellNameEntry[]) {
                    if (entry.name_zh && entry.name_en) {
                        spellNameMap.set(entry.name_zh, entry.name_en);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to load spell name map:', error);
    }
};

loadSpellNameMap();

const containsChinese = (text: string): boolean => {
    return /[\u4e00-\u9fa5]/.test(text);
};

const findPageTitleBySectionTitle = async (bookId: string, sectionTitle: string, isZh: boolean): Promise<string | null> => {
    const outputDir = './output/book';
    const bookDir = join(outputDir, bookId);
    
    try {
        const files = await fs.readdir(bookDir);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const filePath = join(bookDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            
            const found = findTitleInEntry(data, sectionTitle);
            if (found) {
                const displayName = isZh ? data.displayName?.zh : data.displayName?.en;
                if (displayName) {
                    return displayName;
                }
            }
        }
    } catch (e) {
        // 文件不存在或读取失败，返回 null
    }
    
    return null;
};

const findTitleInEntry = (entry: any, targetTitle: string): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    
    if (entry.name === targetTitle || entry.title === targetTitle) {
        return true;
    }
    
    for (const key of Object.keys(entry)) {
        const value = entry[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (findTitleInEntry(item, targetTitle)) {
                    return true;
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            if (findTitleInEntry(value, targetTitle)) {
                return true;
            }
        }
    }
    
    return false;
};

class TagParser {
    allTags: Map<string, Set<string>> = new Map();
    constructor() {}
    /**
     * 解析一个字符串，将其中的tag提取并使用parseSingleTag方法处理，拼合后返回一个字符串。
     * @param input
     * @param isZh - 是否为中文内容
     * @returns
     */
    parse(input: string | number | undefined, isZh: boolean = true): string {
        if (typeof input !== 'string') {
            if (!input) {
                return '';
            }
            return String(input);
        }
        const tagRegex = /{(@\w+)(?:\s+([^}]+))?}/g;
        const parts: (string | TagEntry)[] = [];
        let lastIndex = 0;
        for (const match of input.matchAll(tagRegex)) {
            const [fullMatch, tagName, param] = match;

            if (lastIndex < match.index) {
                parts.push(input.slice(lastIndex, match.index));
            }
            parts.push({ tagName, param: param || null });
            lastIndex = match.index + fullMatch.length;
        }
        if (lastIndex < input.length) {
            parts.push(input.slice(lastIndex));
        }

        const output: string[] = [];
        for (const part of parts) {
            if (typeof part === 'string') output.push(part);
            else {
                output.push(this.parseSingleTag(part, isZh));
            }
        }
        return output.join('');
    }
    parseSingleTag(tag: TagEntry, isZh: boolean = true): string {
        // 处理{@item}标签，为没有来源后缀的物品添加|DMG后缀
        if (tag.tagName === '@item' && tag.param) {
            const parts = tag.param.split('|');
            // 检查是否有来源后缀（parts[1]应该是来源，parts[2]应该是显示文本）
            if (parts.length >= 2 && !parts[1].trim()) {
                // 格式为 {@item name||display}，没有来源后缀，添加|DMG
                const result = `{${tag.tagName} ${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}}`;
                // 保存处理后的参数
                if (this.allTags.has(tag.tagName)) {
                    this.allTags.get(tag.tagName)!.add(`${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}`);
                } else {
                    this.allTags.set(tag.tagName, new Set([`${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}`]));
                }
                return result;
            } else if (parts.length === 1) {
                // 格式为 {@item name}，没有来源后缀，添加|DMG
                const result = `{${tag.tagName} ${parts[0]}|DMG}`;
                // 保存处理后的参数
                if (this.allTags.has(tag.tagName)) {
                    this.allTags.get(tag.tagName)!.add(`${parts[0]}|DMG`);
                } else {
                    this.allTags.set(tag.tagName, new Set([`${parts[0]}|DMG`]));
                }
                return result;
            }
        }

        // 处理{@spell}标签，为没有来源后缀的法术添加|PHB后缀
        // 如果法术名为中文，额外添加en参数记载英文名
        if (tag.tagName === '@spell' && tag.param) {
            const parts = tag.param.split('|');
            const spellName = parts[0].trim();
            let source = parts[1]?.trim() || '';
            let restParams = parts.slice(2);
            
            // 检查是否有来源后缀
            if (!source) {
                source = 'PHB';
            }
            
            // 检查法术名是否为中文，如果是，查找英文名
            let englishName = '';
            if (containsChinese(spellName)) {
                englishName = spellNameMap.get(spellName) || '';
            }
            
            // 检查是否已经有en=参数
            const hasEnParam = restParams.some(p => p.startsWith('en='));
            if (englishName && !hasEnParam) {
                restParams.push(`en=${englishName}`);
            }
            
            // 构建结果
            const restStr = restParams.length > 0 ? '|' + restParams.join('|') : '';
            const result = `{${tag.tagName} ${spellName}|${source}${restStr}}`;
            
            // 保存处理后的参数
            const newParam = `${spellName}|${source}${restStr}`;
            if (this.allTags.has(tag.tagName)) {
                this.allTags.get(tag.tagName)!.add(newParam);
            } else {
                this.allTags.set(tag.tagName, new Set([newParam]));
            }
            
            return result;
        }

        // 处理{@class}标签，将特性位置（等级-索引）转换为特性名称
        if (tag.tagName === '@class' && tag.param) {
            const parts = tag.param.split('|');
            const className = parts[0]?.trim();
            const source = parts[1]; // 保留原始值（可能为空）
            const subclass = parts[2]; // 保留原始值（可能为空）
            const featurePosition = parts[3]?.trim();

            // 如果第四个参数是特性位置格式（等级-索引），尝试转换为特性名称
            let newParam = tag.param;
            if (featurePosition && featurePosition.includes('-')) {
                const [levelStr, indexStr] = featurePosition.split('-');
                const level = parseInt(levelStr, 10);
                const index = parseInt(indexStr, 10);
                
                if (!isNaN(level) && !isNaN(index)) {
                    // 传递子类职业的实际值（可能为空字符串）
                    const subclassValue = subclass?.trim() || '';
                    const featureName = this.findClassNameByPosition(className, source?.trim() || '', subclassValue, level, index, isZh);
                    if (featureName) {
                        // 构建新的标签参数，用特性名称替换位置，保留空值
                        newParam = className;
                        newParam += `|${source || ''}`;  // 保留第二个参数（可能为空）
                        newParam += `|${subclass || ''}`; // 保留第三个参数（可能为空）
                        newParam += `|${featureName}`;
                    }
                }
            }

            // 保存处理后的参数
            if (this.allTags.has(tag.tagName)) {
                this.allTags.get(tag.tagName)!.add(newParam);
            } else {
                this.allTags.set(tag.tagName, new Set([newParam]));
            }

            return `{${tag.tagName} ${newParam}}`;
        }

        // 处理{@book}标签，替换章节索引为页面标题
        if (tag.tagName === '@book' && tag.param) {
            const parts = tag.param.split('|');
            const displayText = parts[0];
            const bookId = parts[1] || '';
            const chapterIndexOrTextIdStr = parts[2];
            const sectionTitle = parts[3];
            const number = parts[4];

            let chapterIndexOrTextId: string | number | undefined;
            if (chapterIndexOrTextIdStr) {
                const parsed = parseInt(chapterIndexOrTextIdStr, 10);
                if (!isNaN(parsed)) {
                    chapterIndexOrTextId = parsed;
                } else {
                    chapterIndexOrTextId = chapterIndexOrTextIdStr;
                }
            }

            // 判断第三个参数是否已经是完整的页面标题（包含/表示层级路径）
            let pageTitle: string | null = null;
            
            // 如果有第四个参数（sectionTitle），优先通过 sectionTitle 查找页面标题
            if (sectionTitle && bookId) {
                pageTitle = sectionTextIdMap.getPageTitleBySectionTitle(bookId, sectionTitle, isZh);
            }
            
            // 如果没有找到（没有第四个参数或查找失败），再检查第三个参数是否是完整页面标题
            if (!pageTitle && chapterIndexOrTextIdStr && chapterIndexOrTextIdStr.includes('/')) {
                pageTitle = chapterIndexOrTextIdStr;
            }
            
            // 如果上述都没找到，按原逻辑处理
            if (!pageTitle && bookId && chapterIndexOrTextId !== undefined) {
                // 尝试获取页面标题
                pageTitle = sectionTextIdMap.getPageTitle(bookId, String(chapterIndexOrTextId), isZh, sectionTitle);
                
                // 如果没找到，尝试将 chapterIndexOrTextId 作为章节索引获取 textId，再用 textId 查找
                if (!pageTitle) {
                    const textIdFromIndex = sectionTextIdMap.getTextId(bookId, chapterIndexOrTextId, sectionTitle);
                    if (textIdFromIndex) {
                        pageTitle = sectionTextIdMap.getPageTitle(bookId, textIdFromIndex, isZh, sectionTitle);
                    }
                }
            }
            
            // 如果没有找到页面标题，使用 textId 作为后备
            let textId: string | null = null;
            if (!pageTitle && bookId) {
                if (chapterIndexOrTextId !== undefined) {
                    textId = sectionTextIdMap.getTextId(bookId, chapterIndexOrTextId, sectionTitle);
                }
                
                if (!textId && sectionTitle) {
                    textId = sectionTextIdMap.getTextIdByTitleOnly(bookId, sectionTitle);
                }
                
                if (!textId && chapterIndexOrTextId !== undefined) {
                    textId = String(chapterIndexOrTextId);
                }
            }

            // 构建新的标签参数
            let newParam = displayText;
            if (bookId) {
                newParam += `|${bookId}`;
                if (pageTitle) {
                    newParam += `|${pageTitle}`;
                    if (sectionTitle) {
                        newParam += `|${sectionTitle}`;
                    }
                    if (number) {
                        newParam += `|${number}`;
                    }
                } else if (textId) {
                    newParam += `|${textId}`;
                    if (sectionTitle) {
                        newParam += `|${sectionTitle}`;
                    }
                    if (number) {
                        newParam += `|${number}`;
                    }
                } else {
                    // 没有找到页面标题或textId，保持原样
                    if (chapterIndexOrTextIdStr) newParam += `|${chapterIndexOrTextIdStr}`;
                    if (sectionTitle) newParam += `|${sectionTitle}`;
                    if (number) newParam += `|${number}`;
                }
            }

            // 保存处理后的参数
            if (this.allTags.has(tag.tagName)) {
                this.allTags.get(tag.tagName)!.add(newParam);
            } else {
                this.allTags.set(tag.tagName, new Set([newParam]));
            }

            return `{${tag.tagName} ${newParam}}`;
        }

        // 保存原始参数
        if (this.allTags.has(tag.tagName)) {
            this.allTags.get(tag.tagName)!.add(tag.param || '');
        } else {
            this.allTags.set(tag.tagName, new Set([tag.param || '']));
        }

        return `{${tag.tagName}${tag.param ? ` ${tag.param}` : ''}}`;
    }
    /**
     * 根据职业名称查找职业数据文件路径
     * 优先查找输出数据（包含英文特性名），其次查找输入数据
     * @param className - 职业名称（可能是中文或英文）
     * @param source - 来源书缩写
     * @returns 文件路径，如果找不到返回 null
     */
    private findClassFilePath(className: string, source: string): string | null {
        // 首先尝试查找输出数据（包含英文特性名）
        const outputDir = './output/class';
        
        try {
            const classDirs = fsSync.readdirSync(outputDir);
            for (const classDir of classDirs) {
                const sourceDir = `${outputDir}/${classDir}/${source}`;
                if (!fsSync.existsSync(sourceDir)) continue;
                
                const files = fsSync.readdirSync(sourceDir);
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    
                    const filePath = `${sourceDir}/${file}`;
                    const content = fsSync.readFileSync(filePath, 'utf-8');
                    const classData = JSON.parse(content);
                    
                    // 检查 displayName 是否匹配
                    if (classData.displayName) {
                        const displayZh = classData.displayName.zh;
                        const displayEn = classData.displayName.en;
                        if (displayZh === className || displayEn === className) {
                            return filePath;
                        }
                    }
                    
                    // 检查 id 是否匹配
                    if (classData.id) {
                        const [classNameFromId] = classData.id.split('|');
                        if (classNameFromId === className) {
                            return filePath;
                        }
                    }
                }
            }
        } catch (error) {
            // 忽略错误
        }
        
        // 如果输出数据找不到，尝试查找输入数据
        const inputDir = './input/5e-cn/data/class';
        
        // 尝试直接构建路径（英文名称）
        const englishNames = [
            className.toLowerCase().replace(/\s+/g, '-'),
            className.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            className.toLowerCase().replace(/\s+/g, ''),
            className.replace(/\s+/g, '-'),
        ];
        
        for (const name of englishNames) {
            const path = `${inputDir}/class-${name}.json`;
            if (fsSync.existsSync(path)) {
                return path;
            }
        }
        
        // 如果英文名称找不到，尝试扫描目录查找匹配的文件
        try {
            const files = fsSync.readdirSync(inputDir);
            for (const file of files) {
                if (!file.startsWith('class-') || !file.endsWith('.json')) continue;
                
                const filePath = `${inputDir}/${file}`;
                const content = fsSync.readFileSync(filePath, 'utf-8');
                const classData = JSON.parse(content);
                
                if (classData.class) {
                    for (const cls of classData.class) {
                        if (cls.name === className || cls.ENG_name === className) {
                            // 如果有来源限制，检查来源是否匹配
                            if (source && cls.source !== source) continue;
                            return filePath;
                        }
                    }
                }
            }
        } catch (error) {
            // 忽略错误
        }
        
        return null;
    }

    /**
     * 根据职业名称、来源、子职业、等级和索引查找特性名称
     * 支持输入数据格式和输出数据格式
     * @param className - 职业名称（可能是中文或英文）
     * @param source - 来源书缩写
     * @param subclass - 子职业名称（可选）
     * @param level - 等级
     * @param index - 特性索引
     * @param isZh - 是否为中文
     * @returns 特性名称，如果找不到返回 null
     */
    private findClassNameByPosition(className: string, source: string, subclass: string, level: number, index: number, isZh: boolean): string | null {
        try {
            // 首先找到正确的职业数据文件
            let classFilePath = this.findClassFilePath(className, source);
            if (!classFilePath) {
                return null;
            }
            
            // 读取职业数据文件
            const content = fsSync.readFileSync(classFilePath, 'utf-8');
            const classData = JSON.parse(content);
            
            // 判断数据格式：输出数据格式（有 zh/en 直接属性）或输入数据格式（有 class/subclass 数组）
            const isOutputFormat = classData.zh && classData.en;
            
            if (isOutputFormat) {
                // 输出数据格式
                const langData = isZh ? classData.zh : classData.en;
                
                // 如果有子职业，查找子职业特性
                if (subclass && subclass.trim() && langData.subclasses) {
                    const targetSubclass = langData.subclasses.find((sub: any) => {
                        const subName = isZh ? sub.name : (sub.ENG_name || sub.name);
                        return subName === subclass;
                    });
                    
                    if (targetSubclass && targetSubclass.subclassFeatures) {
                        // 查找对应等级的子职业特性
                        const levelFeatures = targetSubclass.subclassFeatures.find((lvlFeatures: any) => 
                            lvlFeatures[0]?.level === level
                        );
                        
                        if (levelFeatures && levelFeatures[index]) {
                            const feature = levelFeatures[index];
                            // 中文版本使用 name，英文版本使用 name（英文数据中没有 ENG_name）
                            return feature.name;
                        }
                    }
                }
                
                // 查找主职业特性
                if (langData.classFeatures) {
                    // classFeatures 是按等级索引的数组（索引 0 对应等级 1）
                    const levelIndex = level - 1;
                    const levelFeatures = langData.classFeatures[levelIndex];
                    
                    if (levelFeatures && levelFeatures[index]) {
                        const feature = levelFeatures[index];
                        // 中文版本使用 name，英文版本使用 name（英文数据中没有 ENG_name）
                        return feature.name;
                    }
                }
            } else {
                // 输入数据格式
                // 找到对应的主职业
                let targetClass = classData.class?.find((cls: any) => 
                    cls.name === className || cls.ENG_name === className ||
                    (source && cls.source === source && (cls.name === className || cls.ENG_name === className))
                );
                
                if (!targetClass && source) {
                    targetClass = classData.class?.find((cls: any) => 
                        cls.name === className || cls.ENG_name === className
                    );
                }
                
                if (!targetClass) {
                    return null;
                }
                
                // 如果有子职业，查找子职业特性
                if (subclass && subclass.trim() && classData.subclass) {
                    const targetSubclass = classData.subclass.find((sub: any) => 
                        sub.name === subclass || sub.ENG_name === subclass
                    );
                    
                    if (targetSubclass && targetSubclass.subclassFeatures) {
                        const levelFeatures = targetSubclass.subclassFeatures.find((featureEntry: any) => {
                            if (!featureEntry) return false;
                            const firstFeature = Array.isArray(featureEntry) ? featureEntry[0] : featureEntry;
                            if (!firstFeature) return false;
                            
                            if (typeof firstFeature === 'string') {
                                const parts = firstFeature.split('|');
                                const levelStr = parts[5] || parts[3];
                                return parseInt(levelStr, 10) === level;
                            } else if (typeof firstFeature === 'object') {
                                return firstFeature.level === level;
                            }
                            return false;
                        });
                        
                        if (levelFeatures) {
                            const feature = Array.isArray(levelFeatures) ? levelFeatures[index] : levelFeatures;
                            if (feature) {
                                if (typeof feature === 'string') {
                                    const parts = feature.split('|');
                                    return parts[0];
                                } else if (typeof feature === 'object') {
                                    return isZh ? feature.name : (feature.ENG_name || feature.name);
                                }
                            }
                        }
                    }
                }
                
                // 查找主职业特性
                if (targetClass.classFeatures) {
                    const levelIndex = level - 1;
                    const levelFeatures = targetClass.classFeatures[levelIndex];
                    
                    if (levelFeatures && levelFeatures[index]) {
                        const feature = levelFeatures[index];
                        if (typeof feature === 'string') {
                            const parts = feature.split('|');
                            return parts[0];
                        } else if (typeof feature === 'object') {
                            return isZh ? feature.name : (feature.ENG_name || feature.name);
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    async generateFiles() {
        // save allTags to ./output/tags.json
        const outputDir = './output';
        await fs.mkdir(outputDir, { recursive: true });
        const filePath = `${outputDir}/tags.json`;
        const data = Array.from(this.allTags.entries()).map(([tagName, params]) => ({
            tagName,
            params: Array.from(params),
        }));
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}

export { TagParser };
export const tagParser = new TagParser();
const tag = tagParser.parse.bind(tagParser);

export const parseContent = (content: ParagraphGroup): string => {
    const output: string[] = [];
    for (const item of content) {
        output.push(parseSingleParagraph(item));
    }
    return output.join('\n');
};

const escapeAttribute = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const resolveHref = (href?: ParagraphHref): string => {
    if (!href) return '#';
    const base = href.url || href.path || '#';
    return href.hash ? `${base}#${href.hash}` : base;
};

const parseLink = (item: ParagraphLink): string => {
    const href = escapeAttribute(resolveHref(item.href));
    const text = tag(item.text || resolveHref(item.href));
    return `<a class="parser-link" href="${href}">${text}</a>`;
};

const parseInline = (item: ParagraphInline): string =>
    `<span class="parser-inline">${item.entries
        .map(entry => {
            if (typeof entry === 'string' || typeof entry === 'number') return tag(entry);
            if (entry?.type === 'link') return parseLink(entry);
            return '';
        })
        .join('')}</span>`;

const parseImage = (item: ParagraphImage): string => {
    const src = escapeAttribute(resolveHref(item.href));
    const title = item.title ? tag(item.title) : '';
    const credit = item.credit ? tag(item.credit) : '';
    const width = typeof item.width === 'number' ? ` width="${item.width}"` : '';
    const height = typeof item.height === 'number' ? ` height="${item.height}"` : '';
    const alt = escapeAttribute(item.title || item.credit || 'image');

    let html = `<figure class="parser-image"><img class="parser-image-img" src="${src}" alt="${alt}"${width}${height}>`;
    if (title || credit) {
        html += '<figcaption class="parser-image-caption">';
        if (title) html += `<span class="parser-image-title">${title}</span>`;
        if (credit) html += `<span class="parser-image-credit">${credit}</span>`;
        html += '</figcaption>';
    }
    html += '</figure>';
    return html;
};

const parseStatblockInline = (item: ParagraphStatblockInline): string => {
    const name = item.data?.ENG_name || item.data?.name || '';
    const source = item.data?.source ? escapeAttribute(String(item.data.source)) : '';
    const dataType = item.dataType ? escapeAttribute(item.dataType) : 'unknown';
    const page =
        typeof item.data?.page === 'number' ? ` data-page="${item.data.page}"` : '';
    return `<div class="parser-statblock-inline" data-statblock-type="${dataType}"${
        source ? ` data-source="${source}"` : ''
    }${page}>${tag(name)}</div>`;
};

const parseInsetReadaloud = (item: ParagraphInsetReadaloud): string => {
    let html = `<div class="parser-inset-readaloud">`;
    if (item.name) {
        html += `<div class="parser-inset-readaloud-name">${tag(item.name)}</div>`;
    }
    html += `<div class="parser-inset-readaloud-content">`;
    for (const entry of item.entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseSingleParagraph = (item: ParagraphContentTypes): string => {
    if (typeof item === 'string') {
        return tag(item);
    } else if (item.type === 'inline') {
        return parseInline(item);
    } else if (item.type === 'image') {
        return parseImage(item);
    } else if (item.type === 'statblockInline') {
        return parseStatblockInline(item);
    } else if (item.type === 'table') {
        return parseTable(item);
    } else if (item.type === 'inset') {
        return parseInset(item);
    } else if (item.type === 'insetReadaloud') {
        return parseInsetReadaloud(item);
    } else if (item.type === 'entries') {
        return parseEntries(item);
    } else if (item.type === 'list') {
        return parseList(item);
    } else if (item.type === 'section') {
        return parseSection(item);
    } else if (item.type === 'quote') {
        return parseQuote(item);
    } else {
        console.error(`Unknown paragraph type: ${JSON.stringify(item)}`);

        throw new Error(`Unknown paragraph type`);
    }
};

const parseTable = (item: ParagraphTable): string => {
    const { caption, colLabels, colStyles, rows } = item;
    let html = '<table class="wiki-table">';
    if (caption) {
        html += `<caption>${tag(caption)}</caption>`;
    }
    html += '<tr>';
    for (let i = 0; i < colLabels.length; i++) {
        html += `<th class="parser-${colStyles[i]}">${tag(colLabels[i])}</th>`;
    }
    html += '</tr>';
    for (const row of rows) {
        html += '<tr>';
        for (let i = 0; i < row.length; i++) {
            const cell = row[i];
            if (typeof cell === 'number' || typeof cell === 'string') {
                html += `<td class="parser-${colStyles[i]}">${tag(cell)}</td>`;
            } else if (cell && typeof cell === 'object') {
                html += parseTableCell(cell);
            }
        }
        html += '</tr>';
    }
    html += '</table>';
    return html;
};
const parseTableCell = (cell: ParagraphCell): string => {
    const { roll, entry } = cell;
    return `<td class="parser-cell" data-roll="${roll.exact}">${tag(entry)}</td>`;
};

const parseInset = (item: ParaghaphInset): string => {
    const { name, page, entries } = item;
    let html = `<div class="parser-inset">`;
    html += `<div class=parser-inset-name>${tag(name)}</div>`;
    html += `<div class=parser-inset-entries>`;
    html += `<div class="parser-inset-page">Page: ${page ?? 'N/A'}</div>`;
    html += `<div class="parser-inset-content">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseEntries = (item: ParagraphEntries): string => {
    const { name, ENG_name, type, entries, page } = item;
    let html = `<div class="parser-entries">`;
    if (name) {
        html += `<div class="parser-entries-name">${tag(name)}</div>`;
    }
    if (ENG_name) {
        html += `<div class="parser-entries-eng-name">${tag(ENG_name)}</div>`;
    }
    if (page) {
        html += `<div class="parser-entries-page">Page: ${tag(page)}</div>`;
    }
    html += `<div class="parser-entries-content">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseListItem = (item: ParagraphListItem): string => {
    const { name, entry, entries, ENG_name } = item;
    let html = `<li class="parser-list-item">`;
    if (name) {
        html += `<span class="parser-list-item-name">${tag(name)}</span>`;
    }
    if (ENG_name) {
        html += `<span class="parser-list-item-eng-name">${tag(ENG_name)}</span>`;
    }
    if (entry) {
        html += `<span class="parser-list-item-entry">${tag(entry)}</span>`;
    }
    if (entries) {
        html += `<div class="parser-list-item-entries">`;
        for (const entry of entries) {
            html += parseSingleParagraph(entry);
        }
        html += `</div>`;
    }
    html += `</li>`;
    return html;
};

const parseList = (item: ParagraphList): string => {
    const { style, items } = item;
    let html = `<ul class="parser-list parser-list-${style || 'default'}">`;
    for (const listItem of items) {
        if (typeof listItem === 'string') {
            html += `<li>${tag(listItem)}</li>`;
        } else if (listItem.type === 'item') {
            html += parseListItem(listItem);
        } else if (listItem.type === 'entries') {
            html += parseEntries(listItem);
        } else if (listItem.type === 'list') {
            html += parseList(listItem);
        }
    }
    html += `</ul>`;
    return html;
};

const parseSection = (item: ParagraphSection): string => {
    const { entries } = item;
    let html = `<div class="parser-section">`;
    if (item.name) {
        html += `<div class="parser-section-name">${tag(item.name)}</div>`;
    }
    html += `<div class="parser-section-entries">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseQuote = (item: ParagraphQuote): string => {
    const { entries } = item;
    let html = `<blockquote class="parser-quote">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</blockquote>`;
    return html;
};
