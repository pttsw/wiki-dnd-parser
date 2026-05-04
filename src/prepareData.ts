import {
    BookContents,
    BookFile,
    BookFileEntry,
    BookHeader,
    WikiBookData,
    WikiBookEntry,
} from './types/books';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import chalk from 'chalk';
import { FeatFile, FeatFileEntry, WikiFeatData } from './types/feat';
import {
    ItemBaseFile,
    ItemFile,
    ItemFileEntry,
    ItemFluffContent,
    ItemFluffEntry,
    ItemFluffFile,
    ItemGroup,
    ItemMastery,
    MagicVariantEntry,
    MagicVariantFile,
    MagicVariantRequire,
    ItemProperty,
    ItemType,
    WikiItemData,
    WikiItemMasteryData,
    WikiItemPropertyData,
    WikiItemTypeData,
} from './types/items';
import { parseContent, tagParser } from './contentGen.js';
import config, { mwUtil } from './config.js';
import {
    buildGroupedBlock,
    classifyI18nKeys,
    i18nKeyRules,
    splitRecordByI18n,
} from './i18n.js';
import * as XSLX from 'xlsx';
import {
    SpellClassEntry,
    SpellFile,
    SpellFileEntry,
    SpellFluffContent,
    SpellFluffEntry,
    SpellFluffFile,
    WikiSpellData,
} from './types/spells';
import {
    MonsterFile,
    MonsterFileEntry,
    MonsterFluffEntry,
    MonsterFluffFile,
    WikiBestiaryData,
} from './types/bestiary';
import {
    getBestiaryId,
    normalizeMonsterReferenceSources,
    resolveMonsterFluffContent,
    splitBestiaryRecord,
} from './bestiaryUtils.js';
import { WikiPageGenerator } from './wikiPageGenerator.js';

/**
 * 生成图鉴名称列表文件
 * @param type 图鉴类型，如 'item' 或 'spell'
 * @param items 物品或法术数据数组
 * @param outputDir 输出目录
 */
async function generateCollectionNameList(type: string, items: any[], outputDir: string) {
    try {
        const data = items.map(item => ({
            id: item.id || '',
            src: item.mainSource?.source || '',
            name_en: item.displayName?.en || '',
            name_zh: item.displayName?.zh || item.displayName?.en || ''
        }));
        
        const output = {
            type: type,
            data: data
        };
        
        const outputPath = path.join(outputDir, `${type}namelist.json`);
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        console.log(`已生成 ${type}namelist.json 文件：${outputPath}`);
    } catch (error) {
        console.error(`生成 ${type}namelist.json 文件失败:`, error);
    }
}

/**
 * 从 parser.js 中提取过时源数据列表
 * @param parserJsPath parser.js 文件路径
 * @returns 过时源数据的 Set
 */
async function getLegacySources(parserJsPath: string): Promise<Set<string>> {
    // 默认的过时源数据列表（当无法从 parser.js 获取时使用）
    const legacySources = new Set<string>([
        'PHB',    // 玩家手册 (2014)
        'MM',     // 怪物手册 (2014)
        'DMG',    // 城主指南 (2014)
        'VGM',    // 瓦罗怪物指南
        'MTF',    // 魔邓肯的众敌卷册
    ]);
    
    try {
        const content = await fs.readFile(parserJsPath, 'utf-8');
        
        // 1. 匹配 Parser.SOURCES_LEGACY_WOTC = new Set([...])，支持多行
        const match = content.match(/Parser\.SOURCES_LEGACY_WOTC\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
        if (match && match[1]) {
            // 清空默认列表
            legacySources.clear();
            
            // 2. 提取 Set 中的变量名（如 Parser.SRC_PHB）
            const varRegex = /Parser\.SRC_\w+/g;
            let varMatch;
            const legacyVars: string[] = [];
            while ((varMatch = varRegex.exec(match[1])) !== null) {
                legacyVars.push(varMatch[0]);
            }
            
            // 3. 构建变量名到书籍ID的映射
            const srcVarRegex = /(Parser\.SRC_\w+)\s*=\s*['"]([^'"]+)['"]/g;
            const varToId: Record<string, string> = {};
            let srcMatch;
            while ((srcMatch = srcVarRegex.exec(content)) !== null) {
                varToId[srcMatch[1]] = srcMatch[2];
            }
            
            // 4. 根据变量名获取书籍ID
            for (const legacyVar of legacyVars) {
                const bookId = varToId[legacyVar];
                if (bookId) {
                    legacySources.add(bookId);
                }
            }
            
            console.log(`从 parser.js 获取到 ${legacySources.size} 个过时源数据: ${Array.from(legacySources).join(', ')}`);
        } else {
            console.log(`parser.js 中未找到 SOURCES_LEGACY_WOTC，使用默认列表`);
        }
    } catch (error) {
        console.warn(`无法读取 parser.js 获取过时源数据列表，使用默认列表:`, error);
    }
    return legacySources;
}

/**
 * 生成 Sources.json 文件
 * @param bookMgr BookMgr 实例
 * @param featMgr FeatMgr 实例
 * @param spellMgr SpellMgr 实例
 * @param baseItemMgr BaseItemMgr 实例
 * @param itemMgr ItemMgr 实例
 * @param magicVariantMgr MagicVariantMgr 实例
 * @param bestiaryMgr BestiaryMgr 实例
 * @param outputDir 输出目录
 */
async function generateSourcesJson(
    bookMgr: BookMgr,
    featMgr: FeatMgr,
    spellMgr: SpellMgr,
    baseItemMgr: BaseItemMgr,
    itemMgr: ItemMgr,
    magicVariantMgr: MagicVariantMgr,
    bestiaryMgr: BestiaryMgr,
    outputDir: string
) {
    try {
        const enBooks = bookMgr.raw.en?.book || [];
        const zhBooks = bookMgr.raw.zh?.book || [];

        // 加载 adventures.json
        const adventureFilePath = path.join(config.DATA_ZH_DIR, 'adventures.json');
        let enAdventures: any[] = [];
        try {
            const content = await fs.readFile(adventureFilePath, 'utf-8');
            const adventureData = JSON.parse(content);
            enAdventures = adventureData.adventure || [];
        } catch (error) {
            // adventures.json 可能不存在，使用空数组
        }

        // 从 parser.js 中获取过时源数据列表
        // parser.js 在 DATA_EN_DIR 的同级目录 js/ 下
        const dataEnDir = path.dirname(config.DATA_EN_DIR);
        const parserJsPath = path.join(dataEnDir, 'js/parser.js');
        const legacySources = await getLegacySources(parserJsPath);

        // 收集每个来源包含的类别
        const sourceTypes: Record<string, Set<string>> = {};

        // 初始化每个书籍来源
        for (const enBook of enBooks) {
            sourceTypes[enBook.id] = new Set();
        }

        // 初始化每个冒险来源
        for (const adv of enAdventures) {
            sourceTypes[adv.id] = new Set();
        }

        // 收集专长来源
        for (const item of featMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('feat');
            }
        }

        // 收集法术来源
        for (const item of spellMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('spell');
            }
        }

        // 收集基础物品来源
        for (const item of baseItemMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('item');
            }
        }

        // 收集物品来源
        for (const item of itemMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('item');
            }
        }

        // 收集魔法变体来源
        for (const item of magicVariantMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('item');
            }
        }

        // 收集怪物来源
        for (const item of bestiaryMgr.db.values()) {
            const sourceId = item.mainSource?.source;
            if (sourceId && sourceTypes[sourceId]) {
                sourceTypes[sourceId].add('bestiary');
            }
        }

        const data: Record<string, any> = {};

        // 生成书籍来源数据
        for (const enBook of enBooks) {
            const id = enBook.id;
            const zhBook = zhBooks.find(b => b.id === id);

            data[id] = {
                id: id,
                type: 'book',
                source_name: enBook.name,
                source_published: enBook.published || '',
                source_zhname: zhBook ? zhBook.name : enBook.name,
                newest: !legacySources.has(id),
                have: Array.from(sourceTypes[id] || [])
            };
        }

        // 生成冒险来源数据
        for (const adv of enAdventures) {
            const id = adv.id;

            data[id] = {
                id: id,
                type: 'adventure',
                source_name: adv.name,
                source_published: adv.published || '',
                source_zhname: adv.name,
                newest: !legacySources.has(id),
                have: Array.from(sourceTypes[id] || [])
            };
        }

        const output = {
            type: 'sources',
            data: data
        };

        const outputPath = path.join(outputDir, 'Sources.json');
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        console.log(`已生成 Sources.json 文件：${outputPath}`);
    } catch (error) {
        console.error(`生成 Sources.json 文件失败:`, error);
    }
}

/**
 * 直接在字符串上替换 {=bonusWeapon} 和 {=bonusWeaponDamage}
 */
const replaceBonusInString = (str: string, itemData: any): string => {
    if (typeof str !== 'string') return str;
    
    let result = str;
    
    // 处理 {=bonusWeapon}
    if (result.includes('{=bonusWeapon}')) {
        // 获取 bonusWeapon 值，优先级：
        // 1. zh.inherits.bonusWeapon 或 en.inherits.bonusWeapon（同块）
        // 2. itemData.bonusWeapon
        // 3. itemData.weapon.bonusWeapon
        // 4. itemData.bonus.weapon
        let bonusValue: number | undefined;
        
        // 检查 zh.inherits.bonusWeapon
        if (itemData.zh && itemData.zh.inherits && itemData.zh.inherits.bonusWeapon !== undefined) {
            bonusValue = Number(itemData.zh.inherits.bonusWeapon);
        }
        // 检查 en.inherits.bonusWeapon
        else if (itemData.en && itemData.en.inherits && itemData.en.inherits.bonusWeapon !== undefined) {
            bonusValue = Number(itemData.en.inherits.bonusWeapon);
        }
        // 检查 itemData.bonusWeapon
        else if (itemData.bonusWeapon !== undefined) {
            bonusValue = Number(itemData.bonusWeapon);
        }
        // 检查 itemData.weapon.bonusWeapon
        else if (itemData.weapon && itemData.weapon.bonusWeapon !== undefined) {
            bonusValue = Number(itemData.weapon.bonusWeapon);
        }
        // 检查 itemData.bonus.weapon
        else if (itemData.bonus && itemData.bonus.weapon !== undefined) {
            bonusValue = Number(itemData.bonus.weapon);
        }
        
        // 替换为 {@bonusweapon +数值} 格式
        if (bonusValue !== undefined && !isNaN(bonusValue)) {
            const sign = bonusValue >= 0 ? '+' : '';
            result = result.replace(/{=bonusWeapon}/g, `{@bonusweapon ${sign}${bonusValue}}`);
        }
    }
    
    // 处理 {=bonusWeaponDamage}
    if (result.includes('{=bonusWeaponDamage}')) {
        // 获取 bonusWeaponDamage 值，优先级：
        // 1. zh.inherits.bonusWeaponDamage 或 en.inherits.bonusWeaponDamage（同块）
        // 2. itemData.bonusWeaponDamage
        // 3. itemData.bonus.WeaponDamage
        let bonusValue: number | undefined;
        
        // 检查 zh.inherits.bonusWeaponDamage
        if (itemData.zh && itemData.zh.inherits && itemData.zh.inherits.bonusWeaponDamage !== undefined) {
            bonusValue = Number(itemData.zh.inherits.bonusWeaponDamage);
        }
        // 检查 en.inherits.bonusWeaponDamage
        else if (itemData.en && itemData.en.inherits && itemData.en.inherits.bonusWeaponDamage !== undefined) {
            bonusValue = Number(itemData.en.inherits.bonusWeaponDamage);
        }
        // 检查 itemData.bonusWeaponDamage
        else if (itemData.bonusWeaponDamage !== undefined) {
            bonusValue = Number(itemData.bonusWeaponDamage);
        }
        // 检查 itemData.bonus.WeaponDamage
        else if (itemData.bonus && itemData.bonus.WeaponDamage !== undefined) {
            bonusValue = Number(itemData.bonus.WeaponDamage);
        }
        
        // 替换为 {@bonusweapon +数值} 格式
        if (bonusValue !== undefined && !isNaN(bonusValue)) {
            const sign = bonusValue >= 0 ? '+' : '';
            result = result.replace(/{=bonusWeaponDamage}/g, `{@bonusweapon ${sign}${bonusValue}}`);
        }
    }
    
    // 处理 {=bonusAc}
    if (result.includes('{=bonusAc}')) {
        // 获取 bonusAc 值，优先级：
        // 1. zh.inherits.bonusAc 或 en.inherits.bonusAc（同块）
        // 2. itemData.bonusAc
        // 3. itemData.bonus.ac
        let bonusValue: number | undefined;
        
        // 检查 zh.inherits.bonusAc
        if (itemData.zh && itemData.zh.inherits && itemData.zh.inherits.bonusAc !== undefined) {
            bonusValue = Number(itemData.zh.inherits.bonusAc);
        }
        // 检查 en.inherits.bonusAc
        else if (itemData.en && itemData.en.inherits && itemData.en.inherits.bonusAc !== undefined) {
            bonusValue = Number(itemData.en.inherits.bonusAc);
        }
        // 检查 itemData.bonusAc
        else if (itemData.bonusAc !== undefined) {
            bonusValue = Number(itemData.bonusAc);
        }
        // 检查 itemData.bonus.ac
        else if (itemData.bonus && itemData.bonus.ac !== undefined) {
            bonusValue = Number(itemData.bonus.ac);
        }
        
        // 替换为 {@bonusAc +数值} 格式
        if (bonusValue !== undefined && !isNaN(bonusValue)) {
            const sign = bonusValue >= 0 ? '+' : '';
            result = result.replace(/{=bonusAc}/g, `{@bonusAc ${sign}${bonusValue}}`);
        }
    }
    
    return result;
};

/**
 * 处理物品数据中的 bonus 替换（直接修改原始对象）
 */
const processBonusReplacements = (itemData: any): any => {
    // 处理 zh 部分
    if (itemData.zh) {
        // 处理 entries
        if (itemData.zh.entries) {
            if (Array.isArray(itemData.zh.entries)) {
                itemData.zh.entries = itemData.zh.entries.map((entry: any) => {
                    if (typeof entry === 'string') {
                        return replaceBonusInString(entry, itemData);
                    }
                    return entry;
                });
            } else if (typeof itemData.zh.entries === 'string') {
                itemData.zh.entries = replaceBonusInString(itemData.zh.entries, itemData);
            }
        }
        
        // 处理 html
        if (typeof itemData.zh.html === 'string') {
            itemData.zh.html = replaceBonusInString(itemData.zh.html, itemData);
        }
        
        // 处理 entries_en
        if (itemData.zh.entries_en) {
            if (Array.isArray(itemData.zh.entries_en)) {
                itemData.zh.entries_en = itemData.zh.entries_en.map((entry: any) => {
                    if (typeof entry === 'string') {
                        return replaceBonusInString(entry, itemData);
                    }
                    return entry;
                });
            } else if (typeof itemData.zh.entries_en === 'string') {
                itemData.zh.entries_en = replaceBonusInString(itemData.zh.entries_en, itemData);
            }
        }
        
        // 处理 html_en
        if (typeof itemData.zh.html_en === 'string') {
            itemData.zh.html_en = replaceBonusInString(itemData.zh.html_en, itemData);
        }
        
        // 处理 inherits 部分
        if (itemData.zh.inherits) {
            // 处理 inherits.entries
            if (itemData.zh.inherits.entries) {
                if (Array.isArray(itemData.zh.inherits.entries)) {
                    itemData.zh.inherits.entries = itemData.zh.inherits.entries.map((entry: any) => {
                        if (typeof entry === 'string') {
                            return replaceBonusInString(entry, itemData);
                        }
                        return entry;
                    });
                } else if (typeof itemData.zh.inherits.entries === 'string') {
                    itemData.zh.inherits.entries = replaceBonusInString(itemData.zh.inherits.entries, itemData);
                }
            }
        }
    }
    
    // 处理 en 部分
    if (itemData.en) {
        // 处理 entries
        if (itemData.en.entries) {
            if (Array.isArray(itemData.en.entries)) {
                itemData.en.entries = itemData.en.entries.map((entry: any) => {
                    if (typeof entry === 'string') {
                        return replaceBonusInString(entry, itemData);
                    }
                    return entry;
                });
            } else if (typeof itemData.en.entries === 'string') {
                itemData.en.entries = replaceBonusInString(itemData.en.entries, itemData);
            }
        }
        
        // 处理 html
        if (typeof itemData.en.html === 'string') {
            itemData.en.html = replaceBonusInString(itemData.en.html, itemData);
        }
        
        // 处理 inherits 部分
        if (itemData.en.inherits) {
            // 处理 inherits.entries
            if (itemData.en.inherits.entries) {
                if (Array.isArray(itemData.en.inherits.entries)) {
                    itemData.en.inherits.entries = itemData.en.inherits.entries.map((entry: any) => {
                        if (typeof entry === 'string') {
                            return replaceBonusInString(entry, itemData);
                        }
                        return entry;
                    });
                } else if (typeof itemData.en.inherits.entries === 'string') {
                    itemData.en.inherits.entries = replaceBonusInString(itemData.en.inherits.entries, itemData);
                }
            }
        }
    }
    
    return itemData;
};

export const createOutputFolders = async (generatePages: boolean) => {
    if (!generatePages) {
        // npm run start: 只创建 output 目录
        try {
            await fs.access('./output');
            await fs.rm('./output', { recursive: true, force: true });
        } catch (error) {
            // do nothing, folder does not exist
        }
        const dirs = ['collection', 'item', 'spell', 'generated', 'bestiary', 'namelist'];
        for (const dir of dirs) {
            const dirPath = path.join('./output', dir);
            try {
                await fs.access(dirPath);
            } catch (error) {
                await fs.mkdir(dirPath, { recursive: true });
            }
        }
    } else {
        // npm run page: 只创建 output_page 目录
        try {
            await fs.access('./output_page');
            await fs.rm('./output_page', { recursive: true, force: true });
        } catch (error) {
            // do nothing, folder does not exist
        }
        const pageDirs = ['spells', 'items'];
        for (const dir of pageDirs) {
            const dirPath = path.join('./output_page', dir);
            try {
                await fs.access(dirPath);
            } catch (error) {
                await fs.mkdir(dirPath, { recursive: true });
            }
        }
    }
    return true;
};

export const escapeId = (id: string): string => {
    let output = id;
    // replace "|" with "@"
    output = output.replace(/\|/g, '@');
    // replace "/" with "__"
    output = output.replace(/\//g, '__');
    return output;
};

/**
 * 从 reprintedAs 提取来源信息，用于 allSources
 */
export const parseReprintedAsSources = (
    reprintedAs?: (string | { uid: string; tag?: string })[]
): { source: string; page: number }[] => {
    if (!reprintedAs) return [];
    return reprintedAs.map(entry => {
        const str = typeof entry === 'string' ? entry : entry.uid;
        const source = str.split('|').pop() || '';
        return { source, page: 0 };
    });
};

/**
 * 标准化 reprintedAs 为字符串数组
 */
export const normalizeReprintedAs = (
    reprintedAs?: (string | { uid: string; tag?: string })[]
): string[] => {
    if (!reprintedAs) return [];
    return reprintedAs.map(entry =>
        typeof entry === 'string' ? entry : entry.uid
    );
};

const applyWeaponDerived = (
    block: Record<string, any> | undefined,
    item: ItemFileEntry
) => {
    if (!block) return;
    if (item.weaponCategory && block.category === undefined) {
        block.category = item.weaponCategory;
    }
    const dmgs = [item.dmg1, item.dmg2].filter(d => d !== undefined) as string[];
    if (dmgs.length > 0 && block.dmgs === undefined) {
        block.dmgs = dmgs;
    }
    if (item.range && block.range === undefined) {
        const [min, max] = item.range.split('/');
        block.range = { min: Number(min), max: Number(max) };
    }
    // 添加bonusWeapon到weapon块
    if (item.bonusWeapon !== undefined) {
        block.bonusWeapon = item.bonusWeapon;
    }
    // 添加critThreshold到weapon块
    if (item.critThreshold !== undefined) {
        block.critThreshold = item.critThreshold;
    }
};

const extractTranslator = (
    common: Record<string, any>,
    enOut: Record<string, any>,
    zhOut: Record<string, any>,
    zhRaw?: { translator?: string } | null,
    enRaw?: { translator?: string } | null
): string | undefined => {
    const candidates = [
        common.translator,
        zhOut.translator,
        enOut.translator,
        zhRaw?.translator,
        enRaw?.translator,
    ];
    delete common.translator;
    delete zhOut.translator;
    delete enOut.translator;

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            return candidate.trim();
        }
    }
    return undefined;
};

const hasTextContent = (value: unknown): boolean => {
    if (typeof value === 'string') return true;
    if (Array.isArray(value)) return value.some(hasTextContent);
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some(hasTextContent);
    }
    return false;
};

const appendEnglishShadowFields = (
    zhOut: Record<string, any>,
    enOut: Record<string, any>
) => {
    for (const [key, zhValue] of Object.entries(zhOut)) {
        if (key.endsWith('_en')) continue;
        const enValue = enOut[key];
        if (enValue === undefined) continue;
        if (!hasTextContent(zhValue) && !hasTextContent(enValue)) continue;
        const enKey = `${key}_en`;
        if (zhOut[enKey] === undefined) {
            zhOut[enKey] = enValue;
        }
    }
};

const resolveCaseInsensitiveOutputFileName = (
    usedFileNames: Set<string>,
    preferredFileName: string,
    uniqueSeed: string
): string => {
    const normalize = (value: string) => value.toLocaleLowerCase('en-US');
    const preferredKey = normalize(preferredFileName);
    if (!usedFileNames.has(preferredKey)) {
        usedFileNames.add(preferredKey);
        return preferredFileName;
    }

    const ext = path.extname(preferredFileName);
    const base = ext ? preferredFileName.slice(0, -ext.length) : preferredFileName;
    const hash = createHash('sha1').update(uniqueSeed).digest('hex').slice(0, 8);
    let counter = 1;
    while (true) {
        const suffix = counter === 1 ? hash : `${hash}_${counter}`;
        const nextFileName = `${base}_${suffix}${ext}`;
        const nextKey = normalize(nextFileName);
        if (!usedFileNames.has(nextKey)) {
            usedFileNames.add(nextKey);
            return nextFileName;
        }
        counter += 1;
    }
};

const buildSuperiorfork = (
    hierarchy: {
        origin?: string;
        superior?: string;
        fork?: number;
    },
    inheritsreq = false
): WikiItemData['superiorfork'] | undefined => {
    const superiorfork: NonNullable<WikiItemData['superiorfork']> = {};
    if (typeof hierarchy.origin === 'string' && hierarchy.origin.trim() !== '') {
        superiorfork.origin = hierarchy.origin;
    }
    if (typeof hierarchy.superior === 'string' && hierarchy.superior.trim() !== '') {
        superiorfork.superior = hierarchy.superior;
    }
    if (typeof hierarchy.fork === 'number') {
        superiorfork.fork = hierarchy.fork;
    }
    if (inheritsreq) {
        superiorfork.inheritsreq = true;
    }
    return Object.keys(superiorfork).length > 0 ? superiorfork : undefined;
};

class Logger {
    logs: {
        source: string;
        message: string;
    }[] = [];
    log(source: string, message: string) {
        this.logs.push({ source, message });
    }
    async generateFile() {
        const outputPath = './output/logs.json';
        const output = {
            type: 'logs',
            data: this.logs,
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }
}
export const logger = new Logger();

class ItemFluffMgr {
    map: { zh: Map<string, ItemFluffEntry>; en: Map<string, ItemFluffEntry> } = {
        zh: new Map(),
        en: new Map(),
    };

    private getEntryId(
        entry: { ENG_name?: string; name: string; source?: string },
        fallbackSource?: string
    ): string | undefined {
        const source = entry.source || fallbackSource;
        if (!source) return undefined;
        const name = entry.ENG_name ? entry.ENG_name.trim() : entry.name.trim();
        return `${name}|${source}`;
    }

    loadData(zh: ItemFluffFile | null, en: ItemFluffFile | null) {
        for (const item of en?.itemFluff || []) {
            const id = this.getEntryId(item);
            if (id) this.map.en.set(id, item);
        }
        for (const item of zh?.itemFluff || []) {
            const id = this.getEntryId(item);
            if (id) this.map.zh.set(id, item);
        }
    }

    private resolveEntry(
        lang: 'zh' | 'en',
        id: string,
        visited: Set<string> = new Set()
    ): ItemFluffEntry | undefined {
        if (visited.has(id)) return undefined;
        visited.add(id);
        const entry = this.map[lang].get(id);
        if (!entry) return undefined;
        if (entry.entries || entry.images) return entry;
        if (entry._copy) {
            const copyId = this.getEntryId(entry._copy, entry.source);
            if (!copyId) return entry;
            return this.resolveEntry(lang, copyId, visited) || entry;
        }
        return entry;
    }

    private toContent(lang: 'zh' | 'en', id: string): ItemFluffContent | undefined {
        const entry = this.resolveEntry(lang, id);
        if (!entry) return undefined;
        const { entries, images } = entry;
        if (!entries && !images) return undefined;
        return { entries, images };
    }

    getFull(id: string): { en?: ItemFluffContent; zh?: ItemFluffContent } | undefined {
        const fullEn = this.toContent('en', id);
        const fullZh = this.toContent('zh', id);
        if (!fullEn && !fullZh) return undefined;
        return {
            en: fullEn,
            zh: fullZh,
        };
    }
}

export const itemFluffMgr = new ItemFluffMgr();

type I18nEntry =
    | {
        lang: 'en';
        id: string;
        name_en: string;
        source: string;
    }
    | {
        lang: 'zh';
        id: string;
        name_en: string;
        name_zh: string;
        source: string;
    };

type I18nJoinedEntry = {
    id: string;
    name_en: string;
    zh_name?: string;
    zh_name_engname?: string;
    source: string;
};

class IdMgr {
    dataset: Record<string, any> = {};

    workBook: XSLX.WorkBook = XSLX.utils.book_new();

    constructor() { }

    static matchArrays(a: string[], b: string[]): boolean {
        return a.some(itemA => b.includes(itemA));
    }

    compare<T>(
        dataType: string,
        data: {
            en: T[];
            zh: T[];
        },
        fn: {
            getId: (item?: T | null) => string;
            getZhTitle: (item: T) => string | null;
            getEnTitle: (item: T) => string | null;
        }
    ) {
        this.dataset[dataType] = {
            needZh: [],
            needEn: [],
            matched: [],
        };
        const dataSet = this.dataset[dataType];
        const enIds = data.en.map(fn.getId);
        const zhIds = data.zh.map(fn.getId);
        for (const enId of enIds) {
            if (!zhIds.includes(enId)) {
                dataSet.needZh.push({
                    id: enId,
                    en: fn.getEnTitle(data.en.find(item => fn.getId(item) === enId)!),
                    zh: null,
                });
            }
        }
        for (const zhId of zhIds) {
            if (!enIds.includes(zhId)) {
                dataSet.needEn.push({
                    id: zhId,
                    en: null,
                    zh: fn.getZhTitle(data.zh.find(item => fn.getId(item) === zhId)!),
                });
            }
        }
        for (const enItem of data.en) {
            const enId = fn.getId(enItem);
            const zhItem = data.zh.find(item => fn.getId(item) === enId);
            if (zhItem) {
                dataSet.matched.push({
                    id: enId,
                    en: fn.getEnTitle(enItem),
                    zh: fn.getZhTitle(zhItem),
                });
            }
        }

        const sheetData: string[][] = [];

        // if a sheet with the same name already exists, append data to it (without header)

        for (const item of dataSet.matched) {
            sheetData.push([item.id, item.en || '', item.zh || '']);
        }
        for (const item of dataSet.needEn) {
            sheetData.push([item.id, item.en || '', item.zh || '']);
        }
        for (const item of dataSet.needZh) {
            sheetData.push([item.id, item.en || '', item.zh || '']);
        }

        const currentSheet = this.workBook.Sheets[dataType];
        if (currentSheet) {
            XSLX.utils.sheet_add_aoa(currentSheet, sheetData, { origin: -1 });
        } else {
            const header = ['ID', 'EN Title', 'ZH Title'];
            sheetData.unshift(header);
            const sheet = XSLX.utils.aoa_to_sheet(sheetData);
            XSLX.utils.book_append_sheet(this.workBook, sheet, dataType);
        }
    }

    async generateFiles() {
        const outputPath = './output/idMgr.json';
        const output = {
            type: 'idMgr',
            dataset: this.dataset,
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        try {
            await XSLX.writeFile(this.workBook, './output/idMgr.xlsx');
        } catch (error) {
            if (error instanceof Error) {
                console.error('生成ID管理器Excel文件失败:', error.name);
            }
            console.error('生成ID管理器Excel文件失败:', error);
        }
    }
}
export const idMgr = new IdMgr();

interface DataMgr<T> {
    getId: (item: T) => string;
}

class BookMgr implements DataMgr<BookFileEntry> {
    raw: {
        zh: BookFile | null;
        en: BookFile | null;
    } = {
            zh: null,
            en: null,
        };
    db: Map<string, WikiBookData> = new Map();
    constructor() { }
    getId(book: BookFileEntry): string {
        return book.id;
    }
    static parseBookHeader(contents?: BookContents[]): BookHeader[] {
        if (!contents) return [];
        const headers: BookHeader[] = [];
        for (const content of contents) {
            const header: BookHeader = {
                name: content.name,
                subHeaders: [],
            };
            if (content.headers) {
                for (const subHeader of content.headers) {
                    if (!header.subHeaders) {
                        header.subHeaders = [];
                    }
                    if (typeof subHeader === 'string') {
                        header.subHeaders.push({ name: subHeader });
                    } else {
                        header.subHeaders.push({
                            name: subHeader.header,
                        });
                    }
                }
            }
            headers.push(header);
        }
        return headers;
    }
    static parseBookEntry(entry?: BookFileEntry): WikiBookEntry | null {
        if (!entry) return null;
        return {
            name: entry.name,
            headers: BookMgr.parseBookHeader(entry.contents),
        };
    }

    loadData(zh: BookFile, en: BookFile) {
        this.raw.zh = zh;
        this.raw.en = en;
        this.db.clear();

        idMgr.compare(
            'book',
            { en: en.book, zh: zh.book },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        for (const enBook of en.book) {
            const id = this.getId(enBook);
            const zhBook = zh.book.find(b => this.getId(b) === id);
            if (!zhBook) {
                logger.log('BookMgr', `未找到中文版本的书籍：${enBook.name} (${id})`);
            }

            const bookData: WikiBookData = {
                dataType: 'book',
                uid: `book_${id}`,
                id: id,
                mainSource: {
                    source: enBook.source,
                    page: 0,
                },
                allSources: [],
                displayName: {
                    zh: zhBook ? zhBook.name : null,
                    en: enBook.name,
                },
                group: enBook.group,
                published: enBook.published,
                zh: BookMgr.parseBookEntry(zhBook),
                en: BookMgr.parseBookEntry(enBook)!,
            };

            this.db.set(id, bookData);
        }
    }
    async generateFiles() {
        // dertect if there is a './output/collection/bookCollection.json', if yes, delete it
        const outputPath = './output/collection/bookCollection.json';
        const output = {
            type: 'bookCollection',
            data: Array.from(this.db.values()),
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }
}
export const bookMgr = new BookMgr();

class FeatMgr implements DataMgr<FeatFileEntry> {
    raw: {
        zh: FeatFile | null;
        en: FeatFile | null;
    } = {
            zh: null,
            en: null,
        };
    db: Map<string, WikiFeatData> = new Map();
    reprintMap: Map<string, string[]> = new Map(); // target -> sources

    constructor() { }
    getId(feat: FeatFileEntry): string {
        return `${feat.name}|${feat.source}`;
    }
    loadData(zh: FeatFile, en: FeatFile) {
        this.raw.zh = zh;
        this.raw.en = en;
        this.db.clear();

        idMgr.compare(
            'feat',
            { en: en.feat, zh: zh.feat },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        // 第一遍：建立 reprintMap
        for (const enFeat of en.feat) {
            const id = this.getId(enFeat);
            const reprintedAs = normalizeReprintedAs(enFeat.reprintedAs);
            for (const target of reprintedAs) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        // 第二遍：生成数据
        for (const enFeat of en.feat) {
            const id = this.getId(enFeat);
            const zhFeat = zh.feat.find(f => this.getId(f) === id);
            if (!zhFeat) {
                logger.log('FeatMgr', `未找到中文版本的特性：${enFeat.name} (${id})`);
            }

            // 收集所有相关版本
            const relatedVersions = new Set<string>();
            normalizeReprintedAs(enFeat.reprintedAs).forEach(t => relatedVersions.add(t));
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const featData: WikiFeatData = {
                dataType: 'feat',
                uid: `feat_${id}`,
                id: id,
                mainSource: {
                    source: enFeat.source,
                    page: enFeat.page || 0,
                },
                displayName: {
                    zh: zhFeat ? zhFeat.name : null,
                    en: enFeat.name,
                },
                allSources: (() => {
                    const sources: { source: string; page: number }[] = [];
                    if (enFeat.source) {
                        sources.push({ source: enFeat.source, page: enFeat.page || 0 });
                    }
                    if (enFeat.additionalSources) {
                        sources.push(...enFeat.additionalSources);
                    }
                    sources.push(...parseReprintedAsSources(enFeat.reprintedAs));
                    return sources;
                })(),
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                zh: zhFeat
                    ? {
                        name: zhFeat.name,
                        entries: zhFeat.entries,
                        html: parseContent(zhFeat.entries),
                    }
                    : null,
                en: {
                    name: enFeat.name,
                    entries: enFeat.entries,
                    html: parseContent(enFeat.entries),
                },
            };

            this.db.set(id, featData);
        }
        // add orphan zh feats to idMgr
    }


    async generateFiles() {
        const outputPath = './output/collection/featCollection.json';

        const output = {
            type: 'featCollection',
            data: Array.from(this.db.values()),
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }
}
export const featMgr = new FeatMgr();

class ItemPropertyMgr implements DataMgr<ItemProperty> {
    raw: {
        zh: ItemProperty[] | null;
        en: ItemProperty[] | null;
    } = {
            zh: null,
            en: null,
        };
    db: Map<string, WikiItemPropertyData> = new Map();
    constructor() { }
    getId(item: ItemProperty) {
        return `${item.abbreviation.trim()}|${item.source}`;
    }
    loadData(zh: ItemBaseFile, en: ItemBaseFile) {
        this.raw.zh = zh.itemProperty || null;
        this.raw.en = en.itemProperty || null;
        if (!this.raw.zh) {
            console.warn(chalk.yellow(`未找到中文物品属性数据`));
        }
        if (!this.raw.en) {
            console.warn(chalk.yellow(`未找到英文物品属性数据`));
        }
        this.db.clear();

        const getPropertyName = (item: ItemProperty) => {
            if (item.entries && item.entries.length > 0) {
                const firstEntry = item.entries[0];
                if (
                    typeof firstEntry !== 'string' &&
                    firstEntry.type == 'entries' &&
                    firstEntry.name
                ) {
                    return firstEntry.name;
                }
            }
            if (item.name) {
                return item.name;
            }
            return item.abbreviation;
        };

        idMgr.compare(
            'itemProperty',
            { en: en.itemProperty, zh: zh.itemProperty },
            {
                getId: item => this.getId(item!),
                getEnTitle: getPropertyName,
                getZhTitle: getPropertyName,
            }
        );

        for (const enProperty of en.itemProperty) {
            const id = this.getId(enProperty);
            const zhProperty = zh.itemProperty?.find(p => this.getId(p) === id);
            if (!zhProperty) {
                logger.log(
                    'ItemPropertyMgr',
                    `未找到中文物品属性：${enProperty.abbreviation} (${id})`
                );
            }
            const propertyData: WikiItemPropertyData = {
                dataType: 'itemProperty',
                uid: `itemProperty_${id}`,
                id: id,
                abbreviation: enProperty.abbreviation,
                mainSource: {
                    source: enProperty.source,
                    page: enProperty.page || 0,
                },
                allSources: [],
                displayName: {
                    zh: zhProperty ? getPropertyName(zhProperty) : null,
                    en: getPropertyName(enProperty),
                },
                zh: zhProperty
                    ? {
                        entries: zhProperty.entries || [],
                        name: getPropertyName(zhProperty),
                        html: parseContent(zhProperty.entries || []),
                    }
                    : null,
                en: {
                    entries: enProperty.entries || [],
                    name: getPropertyName(enProperty),
                    html: parseContent(enProperty.entries || []),
                },
            };

            this.db.set(id, propertyData);
        }
    }
    async generateFiles() {
        const outputPath = './output/collection/itemPropertyCollection.json';

        const output = {
            type: 'itemPropertyCollection',
            data: Array.from(this.db.values()),
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }
}
export const itemPropertyMgr = new ItemPropertyMgr();

class ItemTypeMgr implements DataMgr<ItemType> {
    raw: { zh: ItemBaseFile | null; en: ItemBaseFile | null } = {
        zh: null,
        en: null,
    };
    db: Map<string, WikiItemTypeData> = new Map();
    constructor() { }
    getId(item: ItemType) {
        if (typeof item.source !== 'string') {
            console.warn(`unexpected itemType source type: ${typeof item.source}`, item.source);
        }
        return `${item.abbreviation}|${item.source}`;
    }
    loadData(zh: ItemBaseFile, en: ItemBaseFile) {
        this.raw.zh = zh;
        this.raw.en = en;
        this.db.clear();

        idMgr.compare(
            'itemType',
            { en: en.itemType, zh: zh.itemType },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        for (const enType of en.itemType) {
            const id = this.getId(enType);
            const zhType = zh.itemType.find(t => this.getId(t) === id);
            if (!zhType) {
                logger.log('ItemTypeMgr', `未找到中文物品类型：${enType.abbreviation} (${id})`);
            }
            const typeData: WikiItemTypeData = {
                dataType: 'itemType',
                uid: `itemType_${id}`,
                id: id,
                abbreviation: enType.abbreviation,
                mainSource: {
                    source: enType.source,
                    page: enType.page || 0,
                },
                allSources: [],
                displayName: {
                    zh: zhType ? zhType.name : null,
                    en: enType.name,
                },
                zh: zhType
                    ? {
                        name: zhType.name,
                        entries: zhType.entries || [],
                        html: parseContent(zhType.entries || []),
                    }
                    : null,
                en: {
                    name: enType.name,
                    entries: enType.entries || [],
                    html: parseContent(enType.entries || []),
                },
            };

            this.db.set(id, typeData);
        }
    }

    // 从 baseItemMgr 收集各类型对应的基础物品列表
    // 匹配逻辑与 requires 中 type key 的匹配逻辑一致
    collectBaseItems(baseItemMgr: BaseItemMgr) {
        // 创建类型到物品ID列表的映射
        // 支持精确匹配（如 "M|PHB"）和前缀匹配（如 "M" 匹配 "M|PHB"、"M|XPHB"）
        const exactTypeToItemsMap = new Map<string, string[]>();
        const prefixTypeToItemsMap = new Map<string, string[]>();

        for (const [itemId, itemData] of baseItemMgr.db) {
            // 只处理基础物品
            if (!itemData.isBaseItem) continue;

            // 获取物品的类型
            const itemType = itemData.type;
            if (!itemType) continue;

            // 精确匹配：使用完整的 type（如 "M|PHB"）
            if (!exactTypeToItemsMap.has(itemType)) {
                exactTypeToItemsMap.set(itemType, []);
            }
            exactTypeToItemsMap.get(itemType)!.push(itemId);

            // 前缀匹配：提取类型缩写（如 "M"）
            const typeAbbr = itemType.split('|')[0];
            if (!prefixTypeToItemsMap.has(typeAbbr)) {
                prefixTypeToItemsMap.set(typeAbbr, []);
            }
            prefixTypeToItemsMap.get(typeAbbr)!.push(itemId);
        }

        // 将收集到的基础物品列表更新到每个类型数据中
        for (const [typeId, typeData] of this.db) {
            const abbreviation = typeData.abbreviation;
            let baseItemList: string[] = [];

            // 首先尝试精确匹配（如 "M|PHB"）
            const exactMatch = exactTypeToItemsMap.get(typeId);
            if (exactMatch) {
                baseItemList = exactMatch;
            } else {
                // 如果精确匹配失败，尝试前缀匹配（如 "M" 匹配所有 "M|xxx"）
                const prefixMatch = prefixTypeToItemsMap.get(abbreviation);
                if (prefixMatch) {
                    baseItemList = prefixMatch;
                }
            }

            if (baseItemList.length > 0) {
                typeData.baseItemList = baseItemList;
            }
        }
    }

    async generateFiles() {
        const outputPath = './output/collection/itemTypeCollection.json';
        try {
            await fs.access(outputPath);
            await fs.unlink(outputPath);
        } catch (error) {
            // do nothing, file does not exist
        }

        // 收集所有数据
        const data = Array.from(this.db.values());

        // 为只有旧版来源（PHB/DMG）的类别创建新版副本（XPHB/XDMG）
        const additionalTypes: WikiItemTypeData[] = [];
        const typeMap = new Map<string, WikiItemTypeData[]>();

        // 按 abbreviation 分组
        for (const typeData of data) {
            const abbr = typeData.abbreviation;
            if (!typeMap.has(abbr)) {
                typeMap.set(abbr, []);
            }
            typeMap.get(abbr)!.push(typeData);
        }

        // 检查每个类别，补全缺失的新版或旧版来源
        for (const [abbr, types] of typeMap) {
            const hasXPHB = types.some(t => t.mainSource.source === 'XPHB');
            const hasXDMG = types.some(t => t.mainSource.source === 'XDMG');
            const hasPHB = types.some(t => t.mainSource.source === 'PHB');
            const hasDMG = types.some(t => t.mainSource.source === 'DMG');

            // 双向补全：PHB <-> XPHB
            if (hasPHB && !hasXPHB) {
                // 有 PHB 但没有 XPHB，创建 XPHB 副本
                const phbType = types.find(t => t.mainSource.source === 'PHB')!;
                const xphbType = this.createNewVersionType(phbType, 'XPHB');
                additionalTypes.push(xphbType);
            } else if (!hasPHB && hasXPHB) {
                // 有 XPHB 但没有 PHB，创建 PHB 副本
                const xphbType = types.find(t => t.mainSource.source === 'XPHB')!;
                const phbType = this.createNewVersionType(xphbType, 'PHB');
                additionalTypes.push(phbType);
            }

            // 双向补全：DMG <-> XDMG
            if (hasDMG && !hasXDMG) {
                // 有 DMG 但没有 XDMG，创建 XDMG 副本
                const dmgType = types.find(t => t.mainSource.source === 'DMG')!;
                const xdmgType = this.createNewVersionType(dmgType, 'XDMG');
                additionalTypes.push(xdmgType);
            } else if (!hasDMG && hasXDMG) {
                // 有 XDMG 但没有 DMG，创建 DMG 副本
                const xdmgType = types.find(t => t.mainSource.source === 'XDMG')!;
                const dmgType = this.createNewVersionType(xdmgType, 'DMG');
                additionalTypes.push(dmgType);
            }
        }

        // 合并原始数据和新增数据
        const allData = [...data, ...additionalTypes];

        // 添加 WI|XDMG 类别（奇物）
        const wiXdmgType: WikiItemTypeData = {
            dataType: 'itemType',
            uid: 'itemType_WI|XDMG',
            id: 'WI|XDMG',
            abbreviation: 'WI',
            mainSource: {
                source: 'XDMG',
                page: 217,
            },
            allSources: [],
            displayName: {
                zh: '奇物',
                en: 'Wondrous Items',
            },
            zh: {
                name: '奇物',
                entries: ['奇物类别的物品包括但不限于诸如靴子、腰带、斗篷、护符、徽章、头饰之类的可着装物品。背包、毛毯、小型塑像、号角、乐器等物品也都归于此类。'],
                html: '奇物类别的物品包括但不限于诸如靴子、腰带、斗篷、护符、徽章、头饰之类的可着装物品。背包、毛毯、小型塑像、号角、乐器等物品也都归于此类。',
            },
            en: {
                name: 'Wondrous Items',
                entries: ['Wondrous Items include wearable items such as boots, belts, capes, amulets, brooches, and circlets. Bags, carpets, figurines, horns, musical instruments, and more also fall into this category.'],
                html: 'Wondrous Items include wearable items such as boots, belts, capes, amulets, brooches, and circlets. Bags, carpets, figurines, horns, musical instruments, and more also fall into this category.',
            },
        };
        allData.push(wiXdmgType);

        const output = {
            type: 'itemTypeCollection',
            data: allData,
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }

    // 创建新版或旧版来源的类别副本
    private createNewVersionType(originalType: WikiItemTypeData, newSource: 'PHB' | 'DMG' | 'XPHB' | 'XDMG'): WikiItemTypeData {
        const newId = `${originalType.abbreviation}|${newSource}`;

        // 深拷贝原始数据
        const newType: WikiItemTypeData = JSON.parse(JSON.stringify(originalType));

        // 更新 ID 和来源信息
        newType.uid = `itemType_${newId}`;
        newType.id = newId;
        newType.mainSource = {
            source: newSource,
            page: originalType.mainSource.page,
        };

        // 如果有 baseItemList，保留它
        if (originalType.baseItemList) {
            newType.baseItemList = originalType.baseItemList;
        }

        return newType;
    }
}
export const itemTypeMgr = new ItemTypeMgr();

class ItemMasteryMgr implements DataMgr<ItemMastery> {
    raw: {
        zh: ItemMastery[];
        en: ItemMastery[];
    } = {
            zh: [],
            en: [],
        };
    db: Map<string, WikiItemMasteryData> = new Map();
    constructor() { }
    getId(item: ItemMastery) {
        const name = item.ENG_name ? item.ENG_name.trim() : item.name.trim();
        return `${name}|${item.source}`;
    }
    loadData(zh: ItemBaseFile, en: ItemBaseFile) {
        this.raw.zh = zh.itemMastery || [];
        this.raw.en = en.itemMastery || [];
        this.db.clear();

        idMgr.compare(
            'itemMastery',
            { en: this.raw.en, zh: this.raw.zh },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        const zhMap = new Map<string, ItemMastery>();
        for (const item of this.raw.zh) {
            zhMap.set(this.getId(item), item);
        }

        for (const enMastery of this.raw.en) {
            const id = this.getId(enMastery);
            const zhMastery = zhMap.get(id);
            if (!zhMastery) {
                logger.log('ItemMasteryMgr', `未找到中文武器精通词条：${enMastery.name} (${id})`);
            }

            const masteryData: WikiItemMasteryData = {
                dataType: 'itemMastery',
                uid: `itemMastery_${id}`,
                id: id,
                mainSource: {
                    source: enMastery.source,
                    page: enMastery.page || 0,
                },
                allSources: [],
                displayName: {
                    zh: zhMastery ? zhMastery.name : null,
                    en: enMastery.name,
                },
                zh: zhMastery
                    ? {
                        name: zhMastery.name,
                        entries: zhMastery.entries || [],
                        html: parseContent(zhMastery.entries || []),
                    }
                    : null,
                en: {
                    name: enMastery.name,
                    entries: enMastery.entries || [],
                    html: parseContent(enMastery.entries || []),
                },
                srd52: enMastery.srd52,
                basicRules2024: enMastery.basicRules2024,
                freeRules2024: enMastery.freeRules2024,
            };

            this.db.set(id, masteryData);
        }
    }
    async generateFiles() {
        const outputPath = './output/collection/itemMasteryCollection.json';
        const output = {
            type: 'itemMasteryCollection',
            data: Array.from(this.db.values()),
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    }
}
export const itemMasteryMgr = new ItemMasteryMgr();

class BaseItemMgr implements DataMgr<ItemFileEntry> {
    raw: {
        zh: ItemBaseFile | null;
        en: ItemBaseFile | null;
    } = {
            zh: null,
            en: null,
        };
    db: Map<string, WikiItemData> = new Map();
    constructor() { }
    getId(item: ItemFileEntry): string {
        if (item.ENG_name) {
            return `${item.ENG_name.trim()}|${item.source}`;
        }
        return `${item.name.trim()}|${item.source}`;
    }

    static getItemType(item: ItemFileEntry): { type: string; subTypes?: string[] } {
        let type = 'unknown';
        let subTypes: string[] = [];
        if (item.weapon) {
            type = 'weapon';
            if (item.sword) {
                subTypes.push('sword');
            }
            if (item.crossbow) {
                subTypes.push('crossbow');
            }
            if (item.axe) {
                subTypes.push('axe');
            }
            if (item.staff) {
                subTypes.push('staff');
            }
            if (item.club) {
                subTypes.push('club');
            }
            if (item.spear) {
                subTypes.push('spear');
            }
            if (item.dagger) {
                subTypes.push('dagger');
            }
            if (item.hammer) {
                subTypes.push('hammer');
            }
            if (item.bow) {
                subTypes.push('bow');
            }
            if (item.mace) {
                subTypes.push('mace');
            }
            if (item.firearm) {
                subTypes.push('firearm');
            }
            if (item.polearm) {
                subTypes.push('polearm');
            }
            if (item.lance) {
                subTypes.push('lance');
            }
            if (item.rapier) {
                subTypes.push('rapier');
            }
            if (item.tattoo) {
                subTypes.push('tattoo');
            }
        } else if (item.ammoType) {
            type = 'ammo';
            if (item.arrow) {
                subTypes.push('arrow');
            }
            if (item.bolt) {
                subTypes.push('bolt');
            }
            if (item.cellEnergy) {
                subTypes.push('cellEnergy');
            }
            if (item.bulletFirearm) {
                subTypes.push('bulletFirearm');
            }
            if (item.bulletSling) {
                subTypes.push('bulletSling');
            }
        } else if (item.armor) {
            type = 'armor';
            //   subType = 'armor';
        } else if (item.poison) {
            type = 'poison';
            if (item.poisonTypes) {
                subTypes.push(...item.poisonTypes);
            }
        } else if (item.net) {
            type = 'net';
        } else {
            type = 'other';
        }
        return { type, subTypes: subTypes.length > 0 ? subTypes : undefined };
    }
    static getItemSources(item: ItemFileEntry): { source: string; page: number }[] {
        const sources: { source: string; page: number }[] = [];
        if (item.source) {
            sources.push({ source: item.source, page: item.page || 0 });
        }
        if (item.additionalSources) {
            sources.push(...item.additionalSources);
        }
        sources.push(...parseReprintedAsSources(item.reprintedAs));
        return sources;
    }
    reprintMap: Map<string, string[]> = new Map(); // target -> sources
    loadData(zh: ItemBaseFile, en: ItemBaseFile) {
        this.raw.zh = zh;
        this.raw.en = en;
        this.db.clear();

        idMgr.compare(
            'baseitem',
            { en: en.baseitem, zh: zh.baseitem },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        // 第一遍：建立 reprintMap
        for (const enItem of en.baseitem) {
            const id = this.getId(enItem);
            const reprintedAs = normalizeReprintedAs(enItem.reprintedAs);
            for (const target of reprintedAs) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        const itemMap = new Map<string, ItemFileEntry>();
        for (const enItem of en.baseitem) {
            itemMap.set(this.getId(enItem), enItem);
        }
        const zhMap = new Map<string, ItemFileEntry>();
        for (const zhItem of zh.baseitem) {
            zhMap.set(this.getId(zhItem), zhItem);
        }
        const allIds = new Set<string>([
            ...itemMap.keys(),
            ...zhMap.keys(),
        ]);
        const pairs = [...allIds].map(id => ({
            en: itemMap.get(id) || null,
            zh: zhMap.get(id) || null,
        }));
        const keySets = classifyI18nKeys(pairs, i18nKeyRules);

        const collectRelatedIds = (startId: string): string[] => {
            const visited = new Set<string>();
            const stack = [startId];
            while (stack.length > 0) {
                const currentId = stack.pop()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const current = itemMap.get(currentId);
                if (current) {
                    for (const nextId of normalizeReprintedAs(current.reprintedAs)) {
                        if (!visited.has(nextId)) stack.push(nextId);
                    }
                }
                for (const nextId of this.reprintMap.get(currentId) || []) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            return [...visited];
        };

        const buildAllSources = (ids: string[]) => {
            const sources: { source: string; page: number }[] = [];
            const seen = new Set<string>();
            const addSource = (source: string, page: number) => {
                if (!source) return;
                const key = `${source}|${page}`;
                if (seen.has(key)) return;
                seen.add(key);
                sources.push({ source, page });
            };

            for (const relatedId of ids) {
                const relatedItem = itemMap.get(relatedId);
                if (!relatedItem) {
                    const fallbackSource = relatedId.split('|').pop();
                    if (fallbackSource) addSource(fallbackSource, 0);
                    continue;
                }
                for (const extra of BaseItemMgr.getItemSources(relatedItem)) {
                    addSource(extra.source, extra.page);
                }
            }
            return sources;
        };

        // 第二遍：生成数据
        for (const enItem of en.baseitem) {
            const id = this.getId(enItem);
            const zhItem = zh.baseitem.find(i => this.getId(i) === id);
            if (!zhItem) {
                logger.log('BaseItemMgr', `未找到中文版本的物品：${enItem.name} (${id})`);
            }

            // 收集所有相关版本
            const relatedVersions = new Set<string>();
            normalizeReprintedAs(enItem.reprintedAs).forEach(t => relatedVersions.add(t));
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const allSources = buildAllSources(collectRelatedIds(id));

            const split = splitRecordByI18n(enItem, zhItem, keySets, {
                emptyZhValue: '',
                skipKeys: [...i18nKeyRules.weaponKeys, ...i18nKeyRules.armorKeys],
            });
            const weaponGroup = buildGroupedBlock(
                enItem,
                zhItem,
                i18nKeyRules.weaponKeys,
                keySets.localizedKeys,
                ''
            );
            const armorGroup = buildGroupedBlock(
                enItem,
                zhItem,
                i18nKeyRules.armorKeys,
                keySets.localizedKeys,
                ''
            );

            const common = { ...split.common };
            
            // 确保ItemGroup的items字段被包含在common对象中，并为没有来源的物品添加|DMG后缀
            if ('items' in enItem && Array.isArray(enItem.items)) {
                common.items = enItem.items.map((item: string) => {
                    if (typeof item === 'string' && !item.includes('|')) {
                        return `${item}|DMG`;
                    }
                    return item;
                });
            }
            
            // 删除外面的bonusWeapon和critThreshold，只在weapon块中保留
            delete common.bonusWeapon;
            delete common.critThreshold;
            
            // 合并所有武器相关的键到第一层weapon块中
            const weaponBlock: Record<string, any> = {};
            
            // 添加common中的武器相关键
            if (weaponGroup.common) {
                Object.assign(weaponBlock, weaponGroup.common);
            }
            
            // 添加en中的武器相关键
            if (weaponGroup.en) {
                Object.assign(weaponBlock, weaponGroup.en);
            }
            
            // 应用武器派生数据
            applyWeaponDerived(weaponBlock, enItem);
            
            // 如果有武器数据，添加到common中
            if (Object.keys(weaponBlock).length > 0) {
                common.weapon = weaponBlock;
            }
            
            // 合并所有护甲相关的键到第一层armor块中
            const armorBlock: Record<string, any> = {};
            
            // 添加common中的护甲相关键
            if (armorGroup.common) {
                Object.assign(armorBlock, armorGroup.common);
            }
            
            // 添加en中的护甲相关键
            if (armorGroup.en) {
                Object.assign(armorBlock, armorGroup.en);
            }
            
            // 如果有护甲数据，添加到common中
            if (Object.keys(armorBlock).length > 0) {
                common.armor = armorBlock;
            }

            const enOut = { ...split.en };
            const zhOut = { ...split.zh };
            
            // 从enOut和zhOut中删除weapon和armor字段
            delete enOut.weapon;
            delete enOut.armor;
            delete zhOut.weapon;
            delete zhOut.armor;

            const enEntries = enOut.entries ?? [];
            if (Array.isArray(enEntries)) {
                enOut.html = parseContent(enEntries);
            } else if (enEntries === '') {
                enOut.html = '';
            }
            const zhEntries = zhOut.entries;
            if (Array.isArray(zhEntries)) {
                zhOut.html = parseContent(zhEntries);
            } else if (zhEntries === '') {
                zhOut.html = '';
            }
            const translator = extractTranslator(
                common,
                enOut,
                zhOut,
                zhItem as { translator?: string } | undefined,
                enItem as { translator?: string } | undefined
            );
            appendEnglishShadowFields(zhOut, enOut);

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id}`,
                id: id,
                ...common,
                translator,
                isBaseItem: true,
                fork: 0,
                full: itemFluffMgr.getFull(id),
                displayName: {
                    zh: (() => {
                        if (!zhItem) return null;
                        if (zhItem.name.trim() === enItem.name.trim()) return null;
                        return zhItem.name;
                    })(),
                    en: enItem.name,
                },
                mainSource: {
                    source: enItem.source,
                    page: enItem.page || 0,
                },
                allSources,
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                zh: Object.keys(zhOut).length > 0 ? zhOut : null,
                en: enOut,
                charge: enItem.charges
                    ? {
                        max: enItem.charges,
                        rechargeAt: enItem.recharge,
                        rechargeAmount: enItem.rechargeAmount,
                    }
                    : undefined,
                bonus: {
                    weapon: Number(enItem.bonusWeapon) || undefined,
                    weaponAttack: Number(enItem.bonusWeaponAttack) || undefined,
                    weaponDamage: Number(enItem.bonusWeaponDamage) || undefined,
                    spellAttack: Number(enItem.bonusSpellAttack) || undefined,
                    spellSaveDc: Number(enItem.bonusSpellSaveDc) || undefined,
                    ac: Number(enItem.bonusAc) || undefined,
                    savingThrow: Number(enItem.bonusSavingThrow) || undefined,
                    abilityCheck: Number(enItem.bonusAbilityCheck) || undefined,
                    proficiencyBonus: Number(enItem.bonusProficiencyBonus) || undefined,
                },
            };

            this.db.set(id, itemData);
        }
    }
    async generateFiles() {
        const outputDir = './output/item';

        // for each item in the db, write a file.
        for (const [id, itemData] of this.db) {
            const baseName = mwUtil.getMwTitle(
                itemData.displayName.en || itemData.displayName.zh || id
            );
            const sourceId = itemData.mainSource?.source || 'UNKNOWN';
            const fileName = `item_1_${sourceId}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);

            // 如果物品没有 type 字段，添加默认值 WI|XDMG
            if (!itemData.type) {
                itemData.type = 'WI|XDMG';
            }

            // 添加 navpills 和 isnavpill
            const navpills = (itemData as any).navpills;
            const isnavpill = isnavpillIds.has(id);

            // 创建处理过的数据对象
            const processedData: any = { ...itemData };
            
            // 删除 navpills（如果存在），后面会重新添加到正确位置
            delete processedData.navpills;
            
            // 重新构建对象，调整顺序
            const reorderedData: Record<string, any> = {};
            const keys = Object.keys(processedData);
            let insertedFullFields = false;
            
            for (const key of keys) {
                reorderedData[key] = processedData[key];
                // 在 full 字段前插入 navpills 和 isnavpill
                if (key === 'full' && !insertedFullFields) {
                    if (navpills) reorderedData.navpills = true;
                    if (isnavpill) reorderedData.isnavpill = true;
                    insertedFullFields = true;
                }
            }
            
            // 如果没有触发 full 字段的判断，则在最后添加
            if (!insertedFullFields) {
                if (navpills) reorderedData.navpills = true;
                if (isnavpill) reorderedData.isnavpill = true;
            }

            // 添加 itemtype 字段（type 去掉 | 后面的部分）
            reorderedData.itemtype = reorderedData.type.split('|')[0];

            // 添加 simpletype 字段（简略分类）
            const simpletype = this.getSimpleType(reorderedData.type);
            reorderedData.simpletype = simpletype;

            // 添加 MItype 字段（当 rarity 为指定值时）
            const validRarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
            if (reorderedData.rarity && validRarities.includes(reorderedData.rarity)) {
                reorderedData.MItype = simpletype;
                // 添加 MagicItem 字段
                reorderedData.MagicItem = true;
            }

            // 替换 {=bonusWeapon} 和 {=bonusWeaponDamage} 为 {@bonusweapon +数值}
            const finalProcessedData = processBonusReplacements(reorderedData);

            await fs.writeFile(filePath, JSON.stringify(finalProcessedData, null, 2), 'utf-8');
            //     console.log(`已生成物品文件：${ filePath } `);
        }
    }

    // 获取物品的简略分类
    private getSimpleType(type: string): string {
        const typeAbbr = type.split('|')[0];
        
        // 【装备】
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 工具
        if (typeAbbr === 'T' || typeAbbr === 'AT') {
            return '工具';
        }
        // 冒险装备
        if (typeAbbr === 'G') {
            return '冒险用品';
        }
        // 坐骑与载具
        if (typeAbbr === 'VEH' || typeAbbr === 'MNT' || typeAbbr === 'AIR' || typeAbbr === 'SHP' || typeAbbr === 'SPC' || typeAbbr === 'TAH') {
            return '坐骑与载具';
        }
        // 服务
        if (typeAbbr === 'FD') {
            return '食物和饮品';
        }
        
        // 【宝藏】
        // 钱币
        if (typeAbbr === '$C') {
            return '钱币';
        }
        // 贸易金属条
        if (typeAbbr === 'TB') {
            return '贸易金属条';
        }
        // 商业货物
        if (typeAbbr === 'TG') {
            return '商业货物';
        }
        // 宝石
        if (typeAbbr === '$G') {
            return '宝石';
        }
        // 艺术品
        if (typeAbbr === '$A') {
            return '艺术品';
        }
        
        // 【魔法物品】
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 药水
        if (typeAbbr === 'P') {
            return '药水';
        }
        // 戒指
        if (typeAbbr === 'RG') {
            return '戒指';
        }
        // 权杖
        if (typeAbbr === 'RD') {
            return '权杖';
        }
        // 卷轴
        if (typeAbbr === 'SC') {
            return '卷轴';
        }
        // 法杖
        if (typeAbbr === 'SCF') {
            return '法杖';
        }
        // 魔杖
        if (typeAbbr === 'WD') {
            return '魔杖';
        }
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 奇物
        if (typeAbbr === 'OTH' || typeAbbr === 'INS' || typeAbbr === 'WI') {
            return '奇物';
        }
        
        return '其他';
    }
}
export const baseItemMgr = new BaseItemMgr();
class ItemMgr implements DataMgr<ItemFileEntry> {
    raw: {
        zh: ItemFile | null;
        en: ItemFile | null;
    } = {
            zh: null,
            en: null,
        };
    db: Map<string, WikiItemData> = new Map();
    baseItems: BaseItemMgr;
    reprintMap: Map<string, string[]> = new Map(); // target -> sources

    constructor(baseItems: BaseItemMgr) {
        this.baseItems = baseItems;
    }

    getId(item: ItemFileEntry): string {
        if (item.ENG_name) {
            return `${item.ENG_name.trim()}|${item.source}`;
        }
        return `${item.name.trim()}|${item.source}`;
    }
    loadData(zh: ItemFile, en: ItemFile) {
        this.raw.zh = zh;
        this.raw.en = en;
        this.db.clear();

        const enItems = [...(en.item || []), ...(en.itemGroup || [])];
        const zhItems = [...(zh.item || []), ...(zh.itemGroup || [])];

        idMgr.compare(
            'item',
            { en: enItems, zh: zhItems },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        // 第一遍：建立 reprintMap
        for (const enItem of enItems) {
            const id = this.getId(enItem);
            const reprintedAs = normalizeReprintedAs(enItem.reprintedAs);
            for (const target of reprintedAs) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        const itemMap = new Map<string, ItemFileEntry | ItemGroup>();
        for (const enItem of enItems) {
            itemMap.set(this.getId(enItem), enItem);
        }
        const zhMap = new Map<string, ItemFileEntry | ItemGroup>();
        for (const zhItem of zhItems) {
            zhMap.set(this.getId(zhItem), zhItem);
        }
        const allIds = new Set<string>([
            ...itemMap.keys(),
            ...zhMap.keys(),
        ]);
        const pairs = [...allIds].map(id => ({
            en: itemMap.get(id) || null,
            zh: zhMap.get(id) || null,
        }));
        const keySets = classifyI18nKeys(pairs, i18nKeyRules);

        const collectRelatedIds = (startId: string): string[] => {
            const visited = new Set<string>();
            const stack = [startId];
            while (stack.length > 0) {
                const currentId = stack.pop()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const current = itemMap.get(currentId);
                if (current) {
                    for (const nextId of normalizeReprintedAs(current.reprintedAs)) {
                        if (!visited.has(nextId)) stack.push(nextId);
                    }
                }
                for (const nextId of this.reprintMap.get(currentId) || []) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            return [...visited];
        };

        const buildAllSources = (ids: string[]) => {
            const sources: { source: string; page: number }[] = [];
            const seen = new Set<string>();
            const addSource = (source: string, page: number) => {
                if (!source) return;
                const key = `${source}|${page}`;
                if (seen.has(key)) return;
                seen.add(key);
                sources.push({ source, page });
            };

            for (const relatedId of ids) {
                const relatedItem = itemMap.get(relatedId);
                if (!relatedItem) {
                    const fallbackSource = relatedId.split('|').pop();
                    if (fallbackSource) addSource(fallbackSource, 0);
                    continue;
                }
                for (const extra of BaseItemMgr.getItemSources(relatedItem)) {
                    addSource(extra.source, extra.page);
                }
            }
            return sources;
        };

        // 建立从childId到所有可能parentId列表的映射
        const parentsByChild = new Map<string, string[]>();
        for (const group of en.itemGroup || []) {
            const parentId = this.getId(group);
            for (const childId of group.items || []) {
                // 为没有来源后缀的物品添加|DMG后缀，确保格式一致
                let processedChildId = childId;
                if (typeof processedChildId === 'string' && !processedChildId.includes('|')) {
                    processedChildId = `${processedChildId}|DMG`;
                }
                if (!parentsByChild.has(processedChildId)) {
                    parentsByChild.set(processedChildId, []);
                }
                parentsByChild.get(processedChildId)!.push(parentId);
            }
        }

        // 优先选择名字不含(*)的parent
        const selectBestParent = (parents: string[]): string => {
            // 首先尝试找不含(*)的
            const nonStarParents = parents.filter(p => !p.includes('*'));
            if (nonStarParents.length > 0) {
                return nonStarParents[0];
            }
            // 如果都有(*)，返回第一个
            return parents[0];
        };

        const getParent = (id: string): string | undefined => {
            const parents = parentsByChild.get(id);
            if (!parents || parents.length === 0) return undefined;
            return selectBestParent(parents);
        };

        const getTopSuperior = (id: string): string | undefined => {
            const firstParent = getParent(id);
            if (!firstParent) return undefined;
            const visited = new Set<string>([id]);
            let current = firstParent;
            while (true) {
                const nextParents = parentsByChild.get(current);
                if (!nextParents || nextParents.length === 0 || visited.has(current)) break;
                visited.add(current);
                current = selectBestParent(nextParents);
            }
            return current;
        };

        const getForkDepth = (id: string): number => {
            const visited = new Set<string>([id]);
            let depth = 0;
            let current = id;
            while (true) {
                const nextParents = parentsByChild.get(current);
                if (!nextParents || nextParents.length === 0) break;
                const parent = selectBestParent(nextParents);
                if (visited.has(parent)) break;
                visited.add(parent);
                depth += 1;
                current = parent;
            }
            return depth;
        };

        // 第二遍：生成数据
        for (const enItem of enItems) {
            const id = this.getId(enItem);
            const origin = getParent(id);
            const superior = getTopSuperior(id);
            const fork = getForkDepth(id);

            const zhItem = zhItems.find(i => this.getId(i) === id);
            if (!zhItem) {
                logger.log('ItemMgr', `${id}: 未找到中文版本的物品：${enItem.name} `);
            }
            // 收集所有相关版本
            const relatedVersions = new Set<string>();
            normalizeReprintedAs(enItem.reprintedAs).forEach(t => relatedVersions.add(t));
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const allSources = buildAllSources(collectRelatedIds(id));

            const split = splitRecordByI18n(enItem, zhItem, keySets, {
                emptyZhValue: '',
                skipKeys: [...i18nKeyRules.weaponKeys, ...i18nKeyRules.armorKeys],
            });
            const weaponGroup = buildGroupedBlock(
                enItem,
                zhItem,
                i18nKeyRules.weaponKeys,
                keySets.localizedKeys,
                ''
            );
            const armorGroup = buildGroupedBlock(
                enItem,
                zhItem,
                i18nKeyRules.armorKeys,
                keySets.localizedKeys,
                ''
            );

            const common = { ...split.common };
            
            // 确保ItemGroup的items字段被包含在common对象中，并为没有来源的物品添加|DMG后缀
            if ('items' in enItem && Array.isArray(enItem.items)) {
                common.items = enItem.items.map((item: string) => {
                    if (typeof item === 'string' && !item.includes('|')) {
                        return `${item}|DMG`;
                    }
                    return item;
                });
            }
            
            // 删除外面的bonusWeapon和critThreshold，只在weapon块中保留
            delete common.bonusWeapon;
            delete common.critThreshold;
            
            // 合并所有武器相关的键到第一层weapon块中
            const weaponBlock: Record<string, any> = {};
            
            // 添加common中的武器相关键
            if (weaponGroup.common) {
                Object.assign(weaponBlock, weaponGroup.common);
            }
            
            // 添加en中的武器相关键
            if (weaponGroup.en) {
                Object.assign(weaponBlock, weaponGroup.en);
            }
            
            // 应用武器派生数据
            applyWeaponDerived(weaponBlock, enItem);
            
            // 如果有武器数据，添加到common中
            if (Object.keys(weaponBlock).length > 0) {
                common.weapon = weaponBlock;
            }
            
            // 合并所有护甲相关的键到第一层armor块中
            const armorBlock: Record<string, any> = {};
            
            // 添加common中的护甲相关键
            if (armorGroup.common) {
                Object.assign(armorBlock, armorGroup.common);
            }
            
            // 添加en中的护甲相关键
            if (armorGroup.en) {
                Object.assign(armorBlock, armorGroup.en);
            }
            
            // 如果有护甲数据，添加到common中
            if (Object.keys(armorBlock).length > 0) {
                common.armor = armorBlock;
            }

            const enOut = { ...split.en };
            const zhOut = { ...split.zh };
            
            // 从enOut和zhOut中删除weapon和armor字段
            delete enOut.weapon;
            delete enOut.armor;
            delete zhOut.weapon;
            delete zhOut.armor;

            const enEntries = enOut.entries ?? [];
            if (Array.isArray(enEntries)) {
                enOut.html = parseContent(enEntries);
            } else if (enEntries === '') {
                enOut.html = '';
            }
            const zhEntries = zhOut.entries;
            if (Array.isArray(zhEntries)) {
                zhOut.html = parseContent(zhEntries);
            } else if (zhEntries === '') {
                zhOut.html = '';
            }
            const translator = extractTranslator(
                common,
                enOut,
                zhOut,
                zhItem as { translator?: string } | undefined,
                enItem as { translator?: string } | undefined
            );
            appendEnglishShadowFields(zhOut, enOut);
            const superiorfork = buildSuperiorfork({ origin, superior, fork });

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id} `,
                id: id,
                ...common,
                translator,
                isBaseItem: false,
                ...(superiorfork ? { superiorfork } : {}),
                full: itemFluffMgr.getFull(id),
                displayName: {
                    zh: (() => {
                        if (!zhItem) return null;
                        if (zhItem.name.trim() === enItem.name.trim()) return null;
                        return zhItem.name;
                    })(),
                    en: enItem.name,
                },
                mainSource: {
                    source: enItem.source,
                    page: enItem.page || 0,
                },
                allSources,
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                zh: Object.keys(zhOut).length > 0 ? zhOut : null,
                en: enOut,

                charge: enItem.charges
                    ? {
                        max: enItem.charges,
                        rechargeAt: enItem.recharge,
                        rechargeAmount: enItem.rechargeAmount,
                    }
                    : undefined,
                bonus: {
                    weapon: Number(enItem.bonusWeapon) || undefined,
                    weaponAttack: Number(enItem.bonusWeaponAttack) || undefined,
                    weaponDamage: Number(enItem.bonusWeaponDamage) || undefined,
                    spellAttack: Number(enItem.bonusSpellAttack) || undefined,
                    spellSaveDc: Number(enItem.bonusSpellSaveDc) || undefined,
                    ac: Number(enItem.bonusAc) || undefined,
                    savingThrow: Number(enItem.bonusSavingThrow) || undefined,
                    abilityCheck: Number(enItem.bonusAbilityCheck) || undefined,
                    proficiencyBonus: Number(enItem.bonusProficiencyBonus) || undefined,
                },
            };

            this.db.set(id, itemData);
        }
    }
    async generateFiles() {
        const outputDir = './output/item';

        for (const [id, itemData] of this.db) {
            const baseName = mwUtil.getMwTitle(
                itemData.displayName.en || itemData.displayName.zh || id
            );
            const sourceId = itemData.mainSource?.source || 'UNKNOWN';
            const fileName = `item_1_${sourceId}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);

            // 如果物品没有 type 字段，添加默认值 WI|XDMG
            if (!itemData.type) {
                itemData.type = 'WI|XDMG';
            }

            // 添加 navpills 和 isnavpill
            const navpills = (itemData as any).navpills;
            const isnavpill = isnavpillIds.has(id);

            // 创建处理过的数据对象
            const processedData: any = { ...itemData };
            
            // 删除 navpills（如果存在），后面会重新添加到正确位置
            delete processedData.navpills;
            
            // 重新构建对象，调整顺序
            const reorderedData: Record<string, any> = {};
            const keys = Object.keys(processedData);
            let insertedFullFields = false;
            
            for (const key of keys) {
                reorderedData[key] = processedData[key];
                // 在 full 字段前插入 navpills 和 isnavpill
                if (key === 'full' && !insertedFullFields) {
                    if (navpills) reorderedData.navpills = true;
                    if (isnavpill) reorderedData.isnavpill = true;
                    insertedFullFields = true;
                }
            }
            
            // 如果没有触发 full 字段的判断，则在最后添加
            if (!insertedFullFields) {
                if (navpills) reorderedData.navpills = true;
                if (isnavpill) reorderedData.isnavpill = true;
            }

            // 添加 itemtype 字段（type 去掉 | 后面的部分）
            reorderedData.itemtype = reorderedData.type.split('|')[0];

            // 添加 simpletype 字段（简略分类）
            const typeAbbr = reorderedData.type.split('|')[0];
            let simpletype = '其他';
            
            // 【装备】
            if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
                simpletype = '武器';
            } else if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
                simpletype = '护甲';
            } else if (typeAbbr === 'T' || typeAbbr === 'AT') {
                simpletype = '工具';
            } else if (typeAbbr === 'G') {
                simpletype = '冒险用品';
            } else if (typeAbbr === 'VEH' || typeAbbr === 'MNT' || typeAbbr === 'AIR' || typeAbbr === 'SHP' || typeAbbr === 'SPC' || typeAbbr === 'TAH') {
                simpletype = '坐骑与载具';
            } else if (typeAbbr === 'FD') {
                simpletype = '食物和饮品';
            }
            // 【宝藏】
            else if (typeAbbr === '$C') {
                simpletype = '钱币';
            } else if (typeAbbr === 'TB') {
                simpletype = '贸易金属条';
            } else if (typeAbbr === 'TG') {
                simpletype = '商业货物';
            } else if (typeAbbr === '$G') {
                simpletype = '宝石';
            } else if (typeAbbr === '$A') {
                simpletype = '艺术品';
            }
            // 【魔法物品】
            else if (typeAbbr === 'P') {
                simpletype = '药水';
            } else if (typeAbbr === 'RG') {
                simpletype = '戒指';
            } else if (typeAbbr === 'RD') {
                simpletype = '权杖';
            } else if (typeAbbr === 'SC') {
                simpletype = '卷轴';
            } else if (typeAbbr === 'SCF') {
                simpletype = '法杖';
            } else if (typeAbbr === 'WD') {
                simpletype = '魔杖';
            } else if (typeAbbr === 'OTH' || typeAbbr === 'INS' || typeAbbr === 'WI') {
                simpletype = '奇物';
            }
            
            reorderedData.simpletype = simpletype;

            // 添加 MItype 字段（当 rarity 为指定值时）
            const validRarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
            if (reorderedData.rarity && validRarities.includes(reorderedData.rarity)) {
                reorderedData.MItype = simpletype;
                // 添加 MagicItem 字段
                reorderedData.MagicItem = true;
            }

            // 替换 {=bonusWeapon} 和 {=bonusWeaponDamage} 为 {@bonusweapon +数值}
            const finalProcessedData = processBonusReplacements(reorderedData);

            await fs.writeFile(filePath, JSON.stringify(finalProcessedData, null, 2), 'utf-8');
        }
    }

    // 获取物品的简略分类
    private getSimpleType(type: string): string {
        const typeAbbr = type.split('|')[0];
        
        // 【装备】
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 工具
        if (typeAbbr === 'T' || typeAbbr === 'AT') {
            return '工具';
        }
        // 冒险装备
        if (typeAbbr === 'G') {
            return '冒险用品';
        }
        // 坐骑与载具
        if (typeAbbr === 'VEH' || typeAbbr === 'MNT' || typeAbbr === 'AIR' || typeAbbr === 'SHP' || typeAbbr === 'SPC' || typeAbbr === 'TAH') {
            return '坐骑与载具';
        }
        // 服务
        if (typeAbbr === 'FD') {
            return '食物和饮品';
        }
        
        // 【宝藏】
        // 钱币
        if (typeAbbr === '$C') {
            return '钱币';
        }
        // 贸易金属条
        if (typeAbbr === 'TB') {
            return '贸易金属条';
        }
        // 商业货物
        if (typeAbbr === 'TG') {
            return '商业货物';
        }
        // 宝石
        if (typeAbbr === '$G') {
            return '宝石';
        }
        // 艺术品
        if (typeAbbr === '$A') {
            return '艺术品';
        }
        
        // 【魔法物品】
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 药水
        if (typeAbbr === 'P') {
            return '药水';
        }
        // 戒指
        if (typeAbbr === 'RG') {
            return '戒指';
        }
        // 权杖
        if (typeAbbr === 'RD') {
            return '权杖';
        }
        // 卷轴
        if (typeAbbr === 'SC') {
            return '卷轴';
        }
        // 法杖
        if (typeAbbr === 'SCF') {
            return '法杖';
        }
        // 魔杖
        if (typeAbbr === 'WD') {
            return '魔杖';
        }
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 奇物
        if (typeAbbr === 'OTH' || typeAbbr === 'INS' || typeAbbr === 'WI') {
            return '奇物';
        }
        
        return '其他';
    }
}
export const itemMgr = new ItemMgr(baseItemMgr);

class MagicVariantMgr implements DataMgr<MagicVariantEntry> {
    raw: {
        zh: MagicVariantEntry[];
        en: MagicVariantEntry[];
    } = {
            zh: [],
            en: [],
        };
    db: Map<string, WikiItemData> = new Map();
    reprintMap: Map<string, string[]> = new Map(); // target -> sources
    baseItems: BaseItemMgr;
    items: ItemMgr;

    constructor(baseItems: BaseItemMgr, items: ItemMgr) {
        this.baseItems = baseItems;
        this.items = items;
    }

    private getSource(item: MagicVariantEntry): string {
        return (
            item.inherits?.source ||
            item.source ||
            (item.type ? item.type.split('|').pop() || '' : '')
        );
    }

    private getEntries(item: MagicVariantEntry) {
        if (item.entries && item.entries.length > 0) return item.entries;
        return item.inherits?.entries || [];
    }

    private getReprintedAs(item: MagicVariantEntry): string[] {
        return normalizeReprintedAs(item.reprintedAs || item.inherits?.reprintedAs);
    }

    private getVariantDisplayName(item: MagicVariantEntry, baseName: string): string {
        const prefix = item.inherits?.namePrefix || '';
        const suffix = item.inherits?.nameSuffix || '';
        return `${prefix}${baseName}${suffix}`.trim();
    }

    private getVariantMergeData(item: MagicVariantEntry) {
        return {
            ...(item.inherits || {}),
            entries: this.getEntries(item),
        } as Record<string, any>;
    }

    private getBaseSourcePriority(source?: string): number {
        const normalized = String(source || '').toUpperCase();
        if (normalized === 'XPHB') return 0;
        if (normalized === 'PHB') return 1;
        return 2;
    }

    private isExactWeaponGenericRequires(requires?: MagicVariantRequire[]): boolean {
        if (!requires || requires.length !== 1) return false;
        const only = requires[0];
        const keys = Object.keys(only);
        return keys.length === 1 && only.weapon === true;
    }

    private isValueMatch(
        baseValue: any,
        expected: any,
        key: string
    ): boolean {
        if (expected === undefined) return true;
        if (Array.isArray(expected)) {
            if (Array.isArray(baseValue)) {
                return expected.some(v => baseValue.includes(v));
            }
            return expected.includes(baseValue);
        }
        if (typeof expected === 'boolean') {
            return Boolean(baseValue) === expected;
        }
        if (key === 'name' || key === 'source' || key === 'weaponCategory') {
            return String(baseValue || '').toLowerCase() === String(expected).toLowerCase();
        }
        if (key === 'property') {
            const baseProps = Array.isArray(baseValue) ? baseValue : [];
            return baseProps.includes(expected);
        }
        if (key === 'type') {
            // type 支持精确匹配或前缀匹配（如 "M" 匹配 "M|PHB"、"M|XPHB"）
            const baseStr = String(baseValue || '');
            const expectedStr = String(expected);
            return baseStr === expectedStr || baseStr.startsWith(expectedStr + '|');
        }
        return baseValue === expected;
    }

    private matchesConstraint(baseItem: ItemFileEntry, constraint: MagicVariantRequire): boolean {
        const entries = Object.entries(constraint);
        if (entries.length === 0) return false;
        for (const [key, expected] of entries) {
            const actual = (baseItem as Record<string, any>)[key];
            if (!this.isValueMatch(actual, expected, key)) return false;
        }
        return true;
    }

    private matchesRequires(baseItem: ItemFileEntry, requires?: MagicVariantRequire[]): boolean {
        if (!requires || requires.length === 0) return false;
        return requires.some(req => this.matchesConstraint(baseItem, req));
    }

    private matchesExcludes(baseItem: ItemFileEntry, excludes?: MagicVariantRequire): boolean {
        if (!excludes) return false;
        return this.matchesConstraint(baseItem, excludes);
    }

    private getBaseCandidates(
        enItem: MagicVariantEntry,
        baseEnItems: ItemFileEntry[]
    ): ItemFileEntry[] {
        const requires = enItem.requires;
        if (!requires || requires.length === 0) return [];

        let candidates: ItemFileEntry[];
        if (this.isExactWeaponGenericRequires(requires)) {
            const weaponTypes = new Set(['M', 'M|PHB', 'M|XPHB', 'R', 'R|PHB', 'R|XPHB']);
            candidates = baseEnItems.filter(
                it => Boolean(it.weapon) && weaponTypes.has(String(it.type || ''))
            );
        } else {
            candidates = baseEnItems.filter(it => this.matchesRequires(it, requires));
        }

        if (enItem.excludes) {
            candidates = candidates.filter(it => !this.matchesExcludes(it, enItem.excludes));
        }
        return candidates;
    }

    private mergeVariantWithBase(
        baseItem: ItemFileEntry,
        variantData: Record<string, any>,
        mergedName: string,
        source: string,
        page: number,
        baseItemRef: string
    ): Record<string, any> {
        const blockedKeys = new Set([
            'name',
            'ENG_name',
            'type',
            'source',
            'page',
            'requires',
            'excludes',
            'inherits',
            'reprintedAs',
            'entries',
        ]);

        const out: Record<string, any> = { ...baseItem };
        for (const [key, value] of Object.entries(variantData)) {
            if (value === undefined || blockedKeys.has(key)) continue;
            out[key] = value;
        }

        out.name = mergedName;
        out.source = source;
        out.page = page;
        out.type = baseItem.type;
        out.entries = variantData.entries ?? [];
        out.baseItem = baseItemRef;

        if (variantData.bonusWeapon !== undefined && out.bonusWeapon === undefined) {
            out.bonusWeapon = variantData.bonusWeapon;
        }
        if (variantData.critThreshold !== undefined && out.critThreshold === undefined) {
            out.critThreshold = variantData.critThreshold;
        }

        return out;
    }

    private buildVariantItemData(
        enItem: Record<string, any>,
        zhItem: Record<string, any> | null | undefined,
        opts: {
            id: string;
            source: string;
            page: number;
            allSources: { source: string; page: number }[];
            relatedVersions?: Set<string>;
            rarity?: string;
            origin?: string;
            superior?: string;
            fork?: number;
            full?: {
                en?: ItemFluffContent;
                zh?: ItemFluffContent;
            };
        }
    ): WikiItemData {
        const localKeySets = classifyI18nKeys([{ en: enItem, zh: zhItem || null }], i18nKeyRules);
        const split = splitRecordByI18n(enItem, zhItem, localKeySets, {
            emptyZhValue: '',
            skipKeys: [...i18nKeyRules.weaponKeys, ...i18nKeyRules.armorKeys],
        });
        const weaponGroup = buildGroupedBlock(
            enItem,
            zhItem,
            i18nKeyRules.weaponKeys,
            localKeySets.localizedKeys,
            ''
        );
        const armorGroup = buildGroupedBlock(
            enItem,
            zhItem,
            i18nKeyRules.armorKeys,
            localKeySets.localizedKeys,
            ''
        );

        const common = { ...split.common };
        delete common.bonusWeapon;
        delete common.critThreshold;

        const weaponBlock: Record<string, any> = {};
        if (weaponGroup.common) {
            Object.assign(weaponBlock, weaponGroup.common);
        }
        if (weaponGroup.en) {
            Object.assign(weaponBlock, weaponGroup.en);
        }
        applyWeaponDerived(weaponBlock, enItem as ItemFileEntry);
        if (Object.keys(weaponBlock).length > 0) {
            common.weapon = weaponBlock;
        }

        const armorBlock: Record<string, any> = {};
        if (armorGroup.common) {
            Object.assign(armorBlock, armorGroup.common);
        }
        if (armorGroup.en) {
            Object.assign(armorBlock, armorGroup.en);
        }
        if (Object.keys(armorBlock).length > 0) {
            common.armor = armorBlock;
        }

        const enOut = { ...split.en };
        const zhOut = { ...split.zh };
        delete enOut.weapon;
        delete enOut.armor;
        delete zhOut.weapon;
        delete zhOut.armor;

        const enEntries = enOut.entries ?? [];
        if (Array.isArray(enEntries)) {
            enOut.html = parseContent(enEntries);
        } else if (enEntries === '') {
            enOut.html = '';
        }
        const zhEntries = zhOut.entries;
        if (Array.isArray(zhEntries)) {
            zhOut.html = parseContent(zhEntries);
        } else if (zhEntries === '') {
            zhOut.html = '';
        }

        const translator = extractTranslator(
            common,
            enOut,
            zhOut,
            zhItem as { translator?: string } | undefined,
            enItem as { translator?: string } | undefined
        );

        // 处理 inherits 相关逻辑
        // 判断是否是衍生文件：有 origin 字段且 origin 与当前 id 不同，并且有 baseItem 字段（表示是在 inherits 基础上新生成的）
        const isInheritsDerived = opts.origin && opts.origin !== opts.id && enItem.baseItem;
        // 判断是否是基础 inherits 文件：有 inherits 字段但不是衍生文件
        const isInheritsBase = enItem.inherits && !isInheritsDerived;

        // 对于基础 inherits 文件，在 zh.inherits 中添加 ENG_namePrefix
        if (isInheritsBase && zhOut.inherits) {
            const enNamePrefix = enOut.inherits?.namePrefix;
            if (enNamePrefix) {
                zhOut.inherits.ENG_namePrefix = enNamePrefix;
            }
        }

        // 对于衍生文件，添加 inheritsreq: true 并删除英文影子字段
        if (isInheritsDerived) {
            // 删除 zh 中的英文影子字段
            delete zhOut.namePrefix_en;
            delete zhOut.entries_en;
            delete zhOut.html_en;
            delete zhOut.baseItem_en;
            delete zhOut.ENG_name;
            delete zhOut.ENG_namePrefix;
            // 删除最上层的 value 字段
            delete common.value;
        }

        // 只有非 inherits 相关的文件才添加英文影子字段
        if (!isInheritsBase && !isInheritsDerived) {
            appendEnglishShadowFields(zhOut, enOut);
        }

        const superiorfork = buildSuperiorfork(
            {
                superior: opts.superior,
                origin: opts.origin,
                fork: opts.fork,
            },
            isInheritsDerived
        );

        return {
            dataType: 'item',
            uid: `item_${opts.id}`,
            id: opts.id,
            ...common,
            translator,
            rarity: opts.rarity ?? enItem.rarity,
            isBaseItem: false,
            ...(superiorfork ? { superiorfork } : {}),
            full: opts.full,
            displayName: {
                zh: (() => {
                    if (!zhItem) return null;
                    if (String(zhItem.name || '').trim() === String(enItem.name || '').trim()) return null;
                    return String(zhItem.name || '');
                })(),
                en: String(enItem.name || ''),
            },
            mainSource: {
                source: opts.source,
                page: opts.page,
            },
            allSources: opts.allSources,
            relatedVersions:
                opts.relatedVersions && opts.relatedVersions.size > 0
                    ? [...opts.relatedVersions]
                    : undefined,
            zh: Object.keys(zhOut).length > 0 ? zhOut : null,
            en: enOut,
            charge: enItem.charges
                ? {
                    max: enItem.charges,
                    rechargeAt: enItem.recharge,
                    rechargeAmount: enItem.rechargeAmount,
                }
                : undefined,
            bonus: {
                weapon: Number(enItem.bonusWeapon) || undefined,
                weaponAttack: Number(enItem.bonusWeaponAttack) || undefined,
                weaponDamage: Number(enItem.bonusWeaponDamage) || undefined,
                spellAttack: Number(enItem.bonusSpellAttack) || undefined,
                spellSaveDc: Number(enItem.bonusSpellSaveDc) || undefined,
                ac: Number(enItem.bonusAc) || undefined,
                savingThrow: Number(enItem.bonusSavingThrow) || undefined,
                abilityCheck: Number(enItem.bonusAbilityCheck) || undefined,
                proficiencyBonus: Number(enItem.bonusProficiencyBonus) || undefined,
            },
        };
    }

    private getParentByChildMap(): Map<string, string[]> {
        const parentsByChild = new Map<string, string[]>();
        if (!this.items.raw.en) return parentsByChild;
        const enItems = [...(this.items.raw.en.item || []), ...(this.items.raw.en.itemGroup || [])];
        for (const parent of enItems) {
            const parentId = this.items.getId(parent);
            const children = (parent as ItemGroup).items || [];
            for (const childId of children) {
                // 为没有来源后缀的物品添加|DMG后缀，确保格式一致
                let processedChildId = childId;
                if (typeof processedChildId === 'string' && !processedChildId.includes('|')) {
                    processedChildId = `${processedChildId}|DMG`;
                }
                if (!parentsByChild.has(processedChildId)) {
                    parentsByChild.set(processedChildId, []);
                }
                parentsByChild.get(processedChildId)!.push(parentId);
            }
        }
        return parentsByChild;
    }

    // 优先选择名字不含(*)的parent
    private selectBestParent(parents: string[]): string {
        // 首先尝试找不含(*)的
        const nonStarParents = parents.filter(p => !p.includes('*'));
        if (nonStarParents.length > 0) {
            return nonStarParents[0];
        }
        // 如果都有(*)，返回第一个
        return parents[0];
    }

    private getParent(id: string, parentsByChild: Map<string, string[]>): string | undefined {
        const parents = parentsByChild.get(id);
        if (!parents || parents.length === 0) return undefined;
        return this.selectBestParent(parents);
    }

    private getTopSuperior(id: string, parentsByChild: Map<string, string[]>): string | undefined {
        const firstParent = this.getParent(id, parentsByChild);
        if (!firstParent) return undefined;
        const visited = new Set<string>([id]);
        let current = firstParent;
        while (true) {
            const nextParents = parentsByChild.get(current);
            if (!nextParents || nextParents.length === 0 || visited.has(current)) break;
            visited.add(current);
            current = this.selectBestParent(nextParents);
        }
        return current;
    }

    private getForkDepth(id: string, parentsByChild: Map<string, string[]>): number {
        const visited = new Set<string>([id]);
        let depth = 0;
        let current = id;
        while (true) {
            const nextParents = parentsByChild.get(current);
            if (!nextParents || nextParents.length === 0) break;
            const parent = this.selectBestParent(nextParents);
            if (visited.has(parent)) break;
            visited.add(parent);
            depth += 1;
            current = parent;
        }
        return depth;
    }

    getId(item: MagicVariantEntry): string {
        const name = item.ENG_name ? item.ENG_name.trim() : item.name.trim();
        const source = this.getSource(item);
        return `${name}|${source}`;
    }

    loadData(zh: MagicVariantFile | null, en: MagicVariantFile | null) {
        this.raw.zh = zh?.magicvariant || [];
        this.raw.en = en?.magicvariant || [];
        this.db.clear();

        idMgr.compare(
            'magicvariant',
            { en: this.raw.en, zh: this.raw.zh },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        // 第一遍：建立 reprintMap
        for (const enItem of this.raw.en) {
            const id = this.getId(enItem);
            const reprintedAs = this.getReprintedAs(enItem);
            for (const target of reprintedAs) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        const variantMap = new Map<string, MagicVariantEntry>();
        for (const enItem of this.raw.en) {
            variantMap.set(this.getId(enItem), enItem);
        }
        const zhMap = new Map<string, MagicVariantEntry>();
        for (const zhItem of this.raw.zh) {
            zhMap.set(this.getId(zhItem), zhItem);
        }
        const baseEnItems = this.baseItems.raw.en?.baseitem || [];
        const baseZhById = new Map<string, ItemFileEntry>();
        for (const baseZh of this.baseItems.raw.zh?.baseitem || []) {
            baseZhById.set(this.baseItems.getId(baseZh), baseZh);
        }
        const parentsByChild = this.getParentByChildMap();
        const occupiedIds = new Set<string>([
            ...this.baseItems.db.keys(),
            ...this.items.db.keys(),
        ]);
        const templateSuperiorMap = new Map<string, string | undefined>();
        const templateForkMap = new Map<string, number>();

        const collectRelatedIds = (startId: string): string[] => {
            const visited = new Set<string>();
            const stack = [startId];
            while (stack.length > 0) {
                const currentId = stack.pop()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const current = variantMap.get(currentId);
                if (current) {
                    for (const nextId of this.getReprintedAs(current)) {
                        if (!visited.has(nextId)) stack.push(nextId);
                    }
                }
                for (const nextId of this.reprintMap.get(currentId) || []) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            return [...visited];
        };

        const buildAllSources = (ids: string[]) => {
            const sources: { source: string; page: number }[] = [];
            const seen = new Set<string>();
            const addSource = (source: string, page: number) => {
                if (!source) return;
                const key = `${source}|${page}`;
                if (seen.has(key)) return;
                seen.add(key);
                sources.push({ source, page });
            };

            for (const relatedId of ids) {
                const relatedItem = variantMap.get(relatedId);
                if (!relatedItem) {
                    const fallbackSource = relatedId.split('|').pop();
                    if (fallbackSource) addSource(fallbackSource, 0);
                    continue;
                }
                const source = this.getSource(relatedItem);
                addSource(source, relatedItem.inherits?.page || relatedItem.page || 0);
                for (const extra of parseReprintedAsSources(this.getReprintedAs(relatedItem))) {
                    addSource(extra.source, extra.page);
                }
            }
            return sources;
        };

        // 第二遍：生成数据
        for (const enItem of this.raw.en) {
            const id = this.getId(enItem);
            const zhItem = this.raw.zh.find(i => this.getId(i) === id);
            if (!zhItem) {
                logger.log('MagicVariantMgr', `${id}: 未找到中文版本的变体物品：${enItem.name} `);
            }

            const relatedVersions = new Set<string>();
            this.getReprintedAs(enItem).forEach(t => relatedVersions.add(t));
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const source = this.getSource(enItem);
            const allSources = buildAllSources(collectRelatedIds(id));
            const directParent = this.getParent(id, parentsByChild);
            const topSuperior = this.getTopSuperior(id, parentsByChild);
            const forkDepth = this.getForkDepth(id, parentsByChild);
            // 只有当物品有上层物品时，才保持 Math.max(1, ...) 的逻辑
            // 否则直接使用计算出的 fork depth
            const templateFork = directParent ? Math.max(1, forkDepth) : forkDepth;

            const templateData = this.buildVariantItemData(enItem, zhItem, {
                id,
                source,
                page: enItem.inherits?.page || enItem.page || 0,
                allSources,
                relatedVersions,
                rarity: enItem.inherits?.rarity || enItem.rarity,
                origin: directParent,
                superior: topSuperior,
                fork: templateFork,
            });
            this.db.set(id, templateData);
            occupiedIds.add(id);
            templateSuperiorMap.set(id, topSuperior);
            templateForkMap.set(id, templateFork);

            const candidates = this.getBaseCandidates(enItem, baseEnItems)
                .sort((a, b) => this.getBaseSourcePriority(a.source) - this.getBaseSourcePriority(b.source));
            if (candidates.length === 0) continue;

            const templateEnMerge = this.getVariantMergeData(enItem);
            const templateZhMerge = zhItem ? this.getVariantMergeData(zhItem) : null;
            const chosenByName = new Map<string, ItemFileEntry>();

            for (const baseEn of candidates) {
                const derivedName = this.getVariantDisplayName(enItem, baseEn.name);
                const key = derivedName.toLowerCase();
                if (!chosenByName.has(key)) {
                    chosenByName.set(key, baseEn);
                }
            }

            for (const [, baseEn] of chosenByName) {
                const baseId = this.baseItems.getId(baseEn);
                const baseZh = baseZhById.get(baseId);
                const derivedNameEn = this.getVariantDisplayName(enItem, baseEn.name);
                const derivedNameZh = this.getVariantDisplayName(
                    zhItem || enItem,
                    baseZh?.name || baseEn.name
                );

                const page = enItem.inherits?.page || enItem.page || 0;
                const mergedEn = this.mergeVariantWithBase(
                    baseEn,
                    templateEnMerge,
                    derivedNameEn,
                    source,
                    page,
                    `${baseEn.name.toLowerCase()}|${String(baseEn.source || '').toLowerCase()}`
                );
                const mergedZh = baseZh
                    ? this.mergeVariantWithBase(
                        baseZh,
                        templateZhMerge || templateEnMerge,
                        derivedNameZh,
                        source,
                        page,
                        `${(baseZh.name || baseEn.name)}|${String(baseEn.source || '').toLowerCase()}`
                    )
                    : undefined;

                const derivedId = `${derivedNameEn}|${source}`;
                if (occupiedIds.has(derivedId) || this.db.has(derivedId)) {
                    logger.log('MagicVariantMgr', `${id}: 跳过重复衍生物品 ${derivedId}`);
                    continue;
                }

                const derivedAllSources = [...allSources];
                const seenSource = new Set(allSources.map(s => `${s.source}|${s.page}`));
                for (const extra of BaseItemMgr.getItemSources(baseEn)) {
                    const key = `${extra.source}|${extra.page}`;
                    if (seenSource.has(key)) continue;
                    seenSource.add(key);
                    derivedAllSources.push(extra);
                }

                const templateSuperior = templateSuperiorMap.get(id);
                const templateFork = templateForkMap.get(id) ?? 1;
                
                // 判断是否是 inherits 衍生文件（有 inherits 字段的模板生成的衍生文件）
                const isInheritsDerived = enItem.inherits;
                
                // 对于 inherits 衍生文件，full 从 inherits 母本文件（模板）继承
                // 否则从基础物品继承
                const full = isInheritsDerived 
                    ? itemFluffMgr.getFull(id)  // 从 inherits 母本文件获取 fluff
                    : this.baseItems.db.get(baseId)?.full;  // 从基础物品获取 fluff
                
                const derivedData = this.buildVariantItemData(mergedEn, mergedZh, {
                    id: derivedId,
                    source,
                    page,
                    allSources: derivedAllSources,
                    relatedVersions: new Set<string>([id]),
                    rarity: mergedEn.rarity,
                    origin: id,
                    superior: templateSuperior || id,
                    fork: templateFork + 1,
                    full,
                });

                this.db.set(derivedId, derivedData);
                occupiedIds.add(derivedId);
            }
        }
    }

    async generateFiles() {
        const outputDir = './output/item';

        for (const [id, itemData] of this.db) {
            const baseName = mwUtil.getMwTitle(
                itemData.displayName.en || itemData.displayName.zh || id
            );
            const sourceId = itemData.mainSource?.source || 'UNKNOWN';
            const fileName = `item_1_${sourceId}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);

            // 如果物品没有 type 字段，添加默认值 WI|XDMG
            if (!itemData.type) {
                itemData.type = 'WI|XDMG';
            }

            // 添加 navpills 和 isnavpill
            const navpills = (itemData as any).navpills;
            const isnavpill = isnavpillIds.has(id);

            // 创建处理过的数据对象
            const processedData: any = { ...itemData };
            
            // 删除 navpills（如果存在），后面会重新添加到正确位置
            delete processedData.navpills;
            
            // 重新构建对象，调整顺序
            const reorderedData: Record<string, any> = {};
            const keys = Object.keys(processedData);
            let insertedFullFields = false;
            
            for (const key of keys) {
                reorderedData[key] = processedData[key];
                // 在 full 字段前插入 navpills 和 isnavpill
                if (key === 'full' && !insertedFullFields) {
                    if (navpills) reorderedData.navpills = true;
                    if (isnavpill) reorderedData.isnavpill = true;
                    insertedFullFields = true;
                }
            }
            
            // 如果没有触发 full 字段的判断，则在最后添加
            if (!insertedFullFields) {
                if (navpills) reorderedData.navpills = true;
                if (isnavpill) reorderedData.isnavpill = true;
            }

            // 添加 itemtype 字段（type 去掉 | 后面的部分）
            reorderedData.itemtype = reorderedData.type.split('|')[0];

            // 添加 simpletype 字段（简略分类）
            const typeAbbr = reorderedData.type.split('|')[0];
            let simpletype = '其他';
            
            // 【装备】
            if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
                simpletype = '武器';
            } else if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
                simpletype = '护甲';
            } else if (typeAbbr === 'T' || typeAbbr === 'AT') {
                simpletype = '工具';
            } else if (typeAbbr === 'G') {
                simpletype = '冒险用品';
            } else if (typeAbbr === 'VEH' || typeAbbr === 'MNT' || typeAbbr === 'AIR' || typeAbbr === 'SHP' || typeAbbr === 'SPC' || typeAbbr === 'TAH') {
                simpletype = '坐骑与载具';
            } else if (typeAbbr === 'FD') {
                simpletype = '食物和饮品';
            }
            // 【宝藏】
            else if (typeAbbr === '$C') {
                simpletype = '钱币';
            } else if (typeAbbr === 'TB') {
                simpletype = '贸易金属条';
            } else if (typeAbbr === 'TG') {
                simpletype = '商业货物';
            } else if (typeAbbr === '$G') {
                simpletype = '宝石';
            } else if (typeAbbr === '$A') {
                simpletype = '艺术品';
            }
            // 【魔法物品】
            else if (typeAbbr === 'P') {
                simpletype = '药水';
            } else if (typeAbbr === 'RG') {
                simpletype = '戒指';
            } else if (typeAbbr === 'RD') {
                simpletype = '权杖';
            } else if (typeAbbr === 'SC') {
                simpletype = '卷轴';
            } else if (typeAbbr === 'SCF') {
                simpletype = '法杖';
            } else if (typeAbbr === 'WD') {
                simpletype = '魔杖';
            } else if (typeAbbr === 'OTH' || typeAbbr === 'INS' || typeAbbr === 'WI') {
                simpletype = '奇物';
            }
            
            reorderedData.simpletype = simpletype;

            // 添加 MItype 字段（当 rarity 为指定值时）
            const validRarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
            if (reorderedData.rarity && validRarities.includes(reorderedData.rarity)) {
                reorderedData.MItype = simpletype;
                // 添加 MagicItem 字段
                reorderedData.MagicItem = true;
            }

            // 替换 {=bonusWeapon} 和 {=bonusWeaponDamage} 为 {@bonusweapon +数值}
            const finalProcessedData = processBonusReplacements(reorderedData);

            await fs.writeFile(filePath, JSON.stringify(finalProcessedData, null, 2), 'utf-8');
        }
    }

    // 获取物品的简略分类
    private getSimpleType(type: string): string {
        const typeAbbr = type.split('|')[0];
        
        // 【装备】
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 工具
        if (typeAbbr === 'T' || typeAbbr === 'AT') {
            return '工具';
        }
        // 冒险装备
        if (typeAbbr === 'G') {
            return '冒险用品';
        }
        // 坐骑与载具
        if (typeAbbr === 'VEH' || typeAbbr === 'MNT' || typeAbbr === 'AIR' || typeAbbr === 'SHP' || typeAbbr === 'SPC' || typeAbbr === 'TAH') {
            return '坐骑与载具';
        }
        // 服务
        if (typeAbbr === 'FD') {
            return '食物和饮品';
        }
        
        // 【宝藏】
        // 钱币
        if (typeAbbr === '$C') {
            return '钱币';
        }
        // 贸易金属条
        if (typeAbbr === 'TB') {
            return '贸易金属条';
        }
        // 商业货物
        if (typeAbbr === 'TG') {
            return '商业货物';
        }
        // 宝石
        if (typeAbbr === '$G') {
            return '宝石';
        }
        // 艺术品
        if (typeAbbr === '$A') {
            return '艺术品';
        }
        
        // 【魔法物品】
        // 护甲
        if (typeAbbr === 'LA' || typeAbbr === 'MA' || typeAbbr === 'HA' || typeAbbr === 'S') {
            return '护甲';
        }
        // 药水
        if (typeAbbr === 'P') {
            return '药水';
        }
        // 戒指
        if (typeAbbr === 'RG') {
            return '戒指';
        }
        // 权杖
        if (typeAbbr === 'RD') {
            return '权杖';
        }
        // 卷轴
        if (typeAbbr === 'SC') {
            return '卷轴';
        }
        // 法杖
        if (typeAbbr === 'SCF') {
            return '法杖';
        }
        // 魔杖
        if (typeAbbr === 'WD') {
            return '魔杖';
        }
        // 武器
        if (typeAbbr === 'M' || typeAbbr === 'R' || typeAbbr === 'A' || typeAbbr === 'AF') {
            return '武器';
        }
        // 奇物
        if (typeAbbr === 'OTH' || typeAbbr === 'INS' || typeAbbr === 'WI') {
            return '奇物';
        }
        
        return '其他';
    }
}
export const magicVariantMgr = new MagicVariantMgr(baseItemMgr, itemMgr);

class SpellMgr implements DataMgr<SpellFileEntry> {
    raw: {
        zh: SpellFileEntry[];
        en: SpellFileEntry[];
    } = {
            zh: [],
            en: [],
        };
    db: Map<string, WikiSpellData> = new Map();
    spellSources: Record<string, Record<string, { class?: SpellClassEntry[] }>> = {};
    reprintMap: Map<string, string[]> = new Map(); // target -> sources that reprint to it
    fluff: { zh: Map<string, SpellFluffEntry>; en: Map<string, SpellFluffEntry> } = {
        zh: new Map(),
        en: new Map(),
    };

    constructor() { }
    async loadSources(filePath: string) {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            this.spellSources = JSON.parse(data);
        } catch {
            this.spellSources = {};
        }
    }
    getClasses(source: string, name: string): SpellClassEntry[] | undefined {
        return this.spellSources[source]?.[name]?.class;
    }
    loadFluff(zh: SpellFluffFile | null, en: SpellFluffFile | null) {
        for (const item of en?.spellFluff || []) {
            const name = item.ENG_name ? item.ENG_name.trim() : item.name.trim();
            const id = `${name}|${item.source}`;
            this.fluff.en.set(id, item);
        }
        for (const item of zh?.spellFluff || []) {
            const name = item.ENG_name ? item.ENG_name.trim() : item.name.trim();
            const id = `${name}|${item.source}`;
            this.fluff.zh.set(id, item);
        }
    }
    getId(spell: SpellFileEntry): string {
        if (spell.ENG_name) {
            return `${spell.ENG_name.trim()}|${spell.source}`;
        }
        return `${spell.name.trim()}|${spell.source}`;
    }
    loadData(zh: SpellFile | null, en: SpellFile | null) {
        this.raw.zh.push(...(zh?.spell || []));
        this.raw.en.push(...(en?.spell || []));

        idMgr.compare(
            'spell',
            { zh: zh?.spell || [], en: en?.spell || [] },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        // 第一遍：建立 reprintMap
        for (const enSpell of this.raw.en) {
            const id = this.getId(enSpell);
            const reprintedAs = normalizeReprintedAs(enSpell.reprintedAs);
            for (const target of reprintedAs) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        const spellMap = new Map<string, SpellFileEntry>();
        for (const enSpell of this.raw.en) {
            spellMap.set(this.getId(enSpell), enSpell);
        }
        const zhMap = new Map<string, SpellFileEntry>();
        for (const zhSpell of this.raw.zh) {
            zhMap.set(this.getId(zhSpell), zhSpell);
        }
        const allIds = new Set<string>([
            ...spellMap.keys(),
            ...zhMap.keys(),
        ]);
        const pairs = [...allIds].map(id => ({
            en: spellMap.get(id) || null,
            zh: zhMap.get(id) || null,
        }));
        const keySets = classifyI18nKeys(pairs, i18nKeyRules);

        const collectRelatedIds = (startId: string): string[] => {
            const visited = new Set<string>();
            const stack = [startId];
            while (stack.length > 0) {
                const currentId = stack.pop()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const current = spellMap.get(currentId);
                if (current) {
                    for (const nextId of normalizeReprintedAs(current.reprintedAs)) {
                        if (!visited.has(nextId)) stack.push(nextId);
                    }
                }
                for (const nextId of this.reprintMap.get(currentId) || []) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            return [...visited];
        };

        const buildAllSources = (ids: string[]) => {
            const sources: { source: string; page: number }[] = [];
            const seen = new Set<string>();
            const addSource = (source: string, page: number) => {
                if (!source) return;
                const key = `${source}|${page}`;
                if (seen.has(key)) return;
                seen.add(key);
                sources.push({ source, page });
            };

            for (const relatedId of ids) {
                const relatedSpell = spellMap.get(relatedId);
                if (!relatedSpell) {
                    const fallbackSource = relatedId.split('|').pop();
                    if (fallbackSource) addSource(fallbackSource, 0);
                    continue;
                }
                addSource(relatedSpell.source, relatedSpell.page || 0);
                for (const extra of relatedSpell.otherSources || []) {
                    addSource(extra.source, extra.page || 0);
                }
                for (const extra of parseReprintedAsSources(relatedSpell.reprintedAs)) {
                    addSource(extra.source, extra.page);
                }
            }
            return sources;
        };

        // 第二遍：生成数据
        for (const enSpell of this.raw.en) {
            const id = this.getId(enSpell);
            const zhSpell = this.raw.zh.find(s => this.getId(s) === id);
            const fluffEn = this.fluff.en.get(id);
            const fluffZh = this.fluff.zh.get(id);
            const toFluffContent = (
                item?: SpellFluffEntry
            ): SpellFluffContent | undefined => {
                if (!item) return undefined;
                const { entries, images } = item;
                if (!entries && !images) return undefined;
                return { entries, images };
            };

            // 收集所有相关版本
            const relatedVersions = new Set<string>();
            // 添加 reprintedAs 目标（当前条目指向的新版本）
            normalizeReprintedAs(enSpell.reprintedAs).forEach(t => relatedVersions.add(t));
            // 添加指向当前条目的其他条目（其他条目的旧版本）
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const relatedIds = collectRelatedIds(id);
            const split = splitRecordByI18n(enSpell, zhSpell, keySets, {
                emptyZhValue: '',
            });
            const common = { ...split.common };
            const enOut = { ...split.en };
            const zhOut = { ...split.zh };

            const enEntries = enOut.entries ?? enSpell.entries ?? [];
            if (Array.isArray(enEntries)) {
                enOut.entries = enEntries;
                enOut.html = parseContent(enEntries);
            } else if (enEntries === '') {
                enOut.entries = enEntries;
                enOut.html = '';
            }
            const zhEntries =
                zhOut.entries !== undefined
                    ? zhOut.entries
                    : zhSpell
                        ? zhSpell.entries
                        : '';
            if (Array.isArray(zhEntries)) {
                zhOut.entries = zhEntries;
                zhOut.html = parseContent(zhEntries);
            } else if (zhEntries === '') {
                zhOut.entries = zhEntries;
                zhOut.html = '';
            }
            const translator = extractTranslator(common, enOut, zhOut, zhSpell, enSpell);
            appendEnglishShadowFields(zhOut, enOut);

            const spellData: WikiSpellData = {
                dataType: 'spell',
                uid: `spell_${id}`,
                id: id,
                ...common,
                translator,
                displayName: {
                    zh: zhSpell ? zhSpell.name : null,
                    en: enSpell.name,
                },
                mainSource: {
                    source: enSpell.source,
                    page: enSpell.page || 0,
                },
                allSources: buildAllSources(relatedIds),
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                en: enOut,
                zh: Object.keys(zhOut).length > 0 ? zhOut : null,
                level: enSpell.level,
                school: enSpell.school,
                spellAttack: enSpell.spellAttack || [],
                abilityCheck: enSpell.abilityCheck || [],
                damageInflict: enSpell.damageInflict || [],
                damageVulnerable: enSpell.damageVulnerable || [],
                conditionInflict: enSpell.conditionInflict || [],
                damageResist: enSpell.damageResist || [],
                damageImmune: enSpell.damageImmune || [],
                conditionImmune: enSpell.conditionImmune || [],
                savingThrow: enSpell.savingThrow || [],
                affectsCreatureType: enSpell.affectsCreatureType || [],
                ritual: enSpell.meta?.ritual || false,
                classes: this.getClasses(enSpell.source, enSpell.name),
                full: (() => {
                    const fullEn = toFluffContent(fluffEn);
                    const fullZh = toFluffContent(fluffZh);
                    if (!fullEn && !fullZh) return undefined;
                    return {
                        en: fullEn,
                        zh: fullZh,
                    };
                })(),
            };
            this.db.set(id, spellData);
        }
    }

    async generateFiles() {
        const outputDir = './output/spell';
        await fs.mkdir(outputDir, { recursive: true });

        for (const [id, spellData] of this.db) {
            const baseName = mwUtil.getMwTitle(
                spellData.displayName.en || spellData.displayName.zh || id
            );
            const fileName = `Spell_1_${spellData.mainSource.source}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(spellData, null, 2), 'utf-8');
        }
    }
}

export const spellMgr = new SpellMgr();

class BestiaryMgr implements DataMgr<MonsterFileEntry> {
    raw: {
        zh: MonsterFileEntry[];
        en: MonsterFileEntry[];
    } = {
            zh: [],
            en: [],
        };
    fluff: { zh: Map<string, MonsterFluffEntry>; en: Map<string, MonsterFluffEntry> } = {
        zh: new Map(),
        en: new Map(),
    };
    db: Map<string, WikiBestiaryData> = new Map();
    reprintMap: Map<string, string[]> = new Map();

    getId(monster: MonsterFileEntry): string {
        return getBestiaryId(monster);
    }

    loadFluff(zh: MonsterFluffFile | null, en: MonsterFluffFile | null) {
        this.fluff.zh.clear();
        this.fluff.en.clear();
        for (const item of en?.monsterFluff || []) {
            this.fluff.en.set(this.getId(item as MonsterFileEntry), item);
        }
        for (const item of zh?.monsterFluff || []) {
            this.fluff.zh.set(this.getId(item as MonsterFileEntry), item);
        }
    }

    // 构建怪物的层级关系
    private buildMonsterHierarchy() {
        const hierarchyMap = new Map<string, { fork: number; superior: string; origin: string }>();
        const childrenMap = new Map<string, string[]>(); // 记录每个上级怪物的直接下级
        
        // 递归计算层级关系
        const calculateHierarchy = (id: string, visited = new Set<string>()): { fork: number; superior: string; origin: string } => {
            // 避免循环引用
            if (visited.has(id)) {
                return { fork: 0, superior: id, origin: id };
            }
            
            // 检查是否已经计算过
            if (hierarchyMap.has(id)) {
                return hierarchyMap.get(id)!;
            }
            
            // 获取怪物的 fluff 数据
            const fluffEn = this.fluff.en.get(id);
            const fluffZh = this.fluff.zh.get(id);
            const fluff = fluffEn || fluffZh;
            
            // 检查是否有上级文件
            if (fluff?._copy && (fluff._copy.ENG_name || fluff._copy.name) && fluff._copy.source) {
                // 构建上级文件的 ID
                const parentName = fluff._copy.ENG_name || fluff._copy.name;
                const parentId = `${parentName.trim()}|${fluff._copy.source}`;
                
                // 递归计算上级文件的层级关系
                visited.add(id);
                const parentHierarchy = calculateHierarchy(parentId, visited);
                visited.delete(id);
                
                // 计算当前文件的层级关系
                const currentHierarchy = {
                    fork: parentHierarchy.fork + 1,
                    superior: parentHierarchy.superior,
                    origin: parentId
                };
                
                // 记录当前怪物作为上级的直接下级
                if (!childrenMap.has(parentId)) {
                    childrenMap.set(parentId, []);
                }
                childrenMap.get(parentId)!.push(id);
                
                // 缓存结果
                hierarchyMap.set(id, currentHierarchy);
                return currentHierarchy;
            } else {
                // 没有上级文件，层级为 0（顶层）
                const currentHierarchy = {
                    fork: 0,
                    superior: id,
                    origin: id
                };
                
                // 缓存结果
                hierarchyMap.set(id, currentHierarchy);
                return currentHierarchy;
            }
        };
        
        // 为所有怪物计算层级关系
        for (const id of this.db.keys()) {
            calculateHierarchy(id);
        }
        
        return { hierarchyMap, childrenMap };
    }

    loadData(zh: MonsterFile | null, en: MonsterFile | null) {
        this.raw.zh = [...(zh?.monster || [])];
        this.raw.en = [...(en?.monster || [])];
        this.db.clear();
        this.reprintMap.clear();

        idMgr.compare(
            'bestiary',
            { zh: zh?.monster || [], en: en?.monster || [] },
            {
                getId: item => this.getId(item!),
                getEnTitle: item => item.name,
                getZhTitle: item => item.name,
            }
        );

        for (const enMonster of this.raw.en) {
            const id = this.getId(enMonster);
            for (const target of normalizeReprintedAs(enMonster.reprintedAs)) {
                if (!this.reprintMap.has(target)) {
                    this.reprintMap.set(target, []);
                }
                this.reprintMap.get(target)!.push(id);
            }
        }

        const monsterMap = new Map<string, MonsterFileEntry>();
        for (const enMonster of this.raw.en) {
            monsterMap.set(this.getId(enMonster), enMonster);
        }
        const zhMap = new Map<string, MonsterFileEntry>();
        for (const zhMonster of this.raw.zh) {
            zhMap.set(this.getId(zhMonster), zhMonster);
        }

        const collectRelatedIds = (startId: string): string[] => {
            const visited = new Set<string>();
            const stack = [startId];
            while (stack.length > 0) {
                const currentId = stack.pop()!;
                if (visited.has(currentId)) continue;
                visited.add(currentId);

                const current = monsterMap.get(currentId);
                if (current) {
                    for (const nextId of normalizeReprintedAs(current.reprintedAs)) {
                        if (!visited.has(nextId)) stack.push(nextId);
                    }
                }
                for (const nextId of this.reprintMap.get(currentId) || []) {
                    if (!visited.has(nextId)) stack.push(nextId);
                }
            }
            return [...visited];
        };

        const buildAllSources = (ids: string[]) => {
            const sources: { source: string; page: number }[] = [];
            const seen = new Set<string>();
            const addSource = (source: string, page: number) => {
                if (!source) return;
                const key = `${source}|${page}`;
                if (seen.has(key)) return;
                seen.add(key);
                sources.push({ source, page });
            };

            for (const relatedId of ids) {
                const relatedMonster = monsterMap.get(relatedId);
                if (!relatedMonster) {
                    const fallbackSource = relatedId.split('|').pop();
                    if (fallbackSource) addSource(fallbackSource, 0);
                    continue;
                }
                addSource(relatedMonster.source, relatedMonster.page || 0);
                for (const extra of normalizeMonsterReferenceSources(relatedMonster)) {
                    addSource(extra.source, extra.page);
                }
                for (const extra of parseReprintedAsSources(relatedMonster.reprintedAs)) {
                    addSource(extra.source, extra.page);
                }
            }
            return sources;
        };

        for (const enMonster of this.raw.en) {
            const id = this.getId(enMonster);
            const zhMonster = zhMap.get(id);
            const fluffEn = this.fluff.en.get(id);
            const fluffZh = this.fluff.zh.get(id);

            if (!zhMonster) {
                logger.log('BestiaryMgr', `未找到中文怪物：${enMonster.name} (${id})`);
            }
            if (fluffEn && !fluffZh) {
                logger.log('BestiaryMgr', `未找到中文怪物Fluff：${enMonster.name} (${id})`);
            }

            const relatedVersions = new Set<string>();
            normalizeReprintedAs(enMonster.reprintedAs).forEach(target => relatedVersions.add(target));
            this.reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

            const split = splitBestiaryRecord(enMonster, zhMonster);
            const common = { ...split.common };
            const enOut = { ...split.en };
            const zhOut = { ...split.zh };
            const translator = extractTranslator(common, enOut, zhOut, zhMonster, enMonster);
            const referenceSources = normalizeMonsterReferenceSources(enMonster);
            const fullEn = resolveMonsterFluffContent(fluffEn, this.fluff.en, new Set(), false); // 英文不使用_copy追踪
            const fullZh = resolveMonsterFluffContent(fluffZh, this.fluff.zh); // 中文保持原有的_copy追踪

            const bestiaryData: WikiBestiaryData = {
                dataType: 'bestiary',
                uid: `bestiary_${id}`,
                id,
                ...common,
                referenceSources,
                translator,
                displayName: {
                    zh: zhMonster ? zhMonster.name : null,
                    en: enMonster.name,
                },
                mainSource: {
                    source: enMonster.source,
                    page: enMonster.page || 0,
                },
                allSources: buildAllSources(collectRelatedIds(id)),
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                full: fullEn || fullZh ? { en: fullEn, zh: fullZh } : undefined,
                zh: Object.keys(zhOut).length > 0 ? zhOut : null,
                en: enOut,
            };
            this.db.set(id, bestiaryData);
        }

        for (const [id, zhFluff] of this.fluff.zh) {
            if (!monsterMap.has(id)) {
                logger.log('BestiaryMgr', `中文怪物Fluff缺少英文主条目：${zhFluff.name} (${id})`);
            }
        }

        const fluffOnlyIds = new Set<string>([
            ...this.fluff.en.keys(),
            ...this.fluff.zh.keys(),
        ]);
        for (const id of fluffOnlyIds) {
            if (this.db.has(id) || monsterMap.has(id)) continue;

            const fluffEn = this.fluff.en.get(id);
            const fluffZh = this.fluff.zh.get(id);
            const source = fluffEn?.source || fluffZh?.source;
            if (!source) continue;

            const enOut: Record<string, any> = fluffEn
                ? { name: fluffEn.name }
                : { name: fluffZh?.ENG_name || fluffZh?.name || id.split('|')[0] };
            const zhOut: Record<string, any> = fluffZh
                ? {
                    name: fluffZh.name,
                    ...(fluffZh.ENG_name ? { ENG_name: fluffZh.ENG_name } : {}),
                }
                : {};
            const common: Record<string, any> = {
                source,
                page: 0,
            };
            const translator = extractTranslator(
                common,
                enOut,
                zhOut,
                fluffZh as { translator?: string } | undefined,
                fluffEn as { translator?: string } | undefined
            );
            const fullEn = resolveMonsterFluffContent(fluffEn, this.fluff.en);
            const fullZh = resolveMonsterFluffContent(fluffZh, this.fluff.zh);
            if (!fullEn && !fullZh) continue;

            const bestiaryData: WikiBestiaryData = {
                dataType: 'bestiary',
                uid: `bestiary_${id}`,
                id,
                ...common,
                referenceSources: [],
                translator,
                displayName: {
                    zh: fluffZh ? fluffZh.name : null,
                    en: fluffEn?.name || fluffZh?.ENG_name || fluffZh?.name || id.split('|')[0],
                },
                mainSource: {
                    source,
                    page: 0,
                },
                allSources: [{ source, page: 0 }],
                full: {
                    en: fullEn,
                    zh: fullZh,
                },
                zh: Object.keys(zhOut).length > 0 ? zhOut : null,
                en: enOut,
                onlyfull: true,
            };
            this.db.set(id, bestiaryData);
        }

        // 构建怪物的层级关系并添加 superiorfork 字段
        const { hierarchyMap, childrenMap } = this.buildMonsterHierarchy();
        for (const [id, bestiaryData] of this.db) {
            const hierarchy = hierarchyMap.get(id);
            if (hierarchy) {
                bestiaryData.superiorfork = {
                    fork: hierarchy.fork,
                    ...(hierarchy.fork > 0 ? { superior: hierarchy.superior, origin: hierarchy.origin } : {})
                };
            }
            
            // 添加 bestiaries 字段，记录直接下级
            const children = childrenMap.get(id);
            if (children && children.length > 0) {
                // 按照年龄阶段排序：Wyrmling -> Young -> Adult -> Ancient
                const sortedChildren = [...children].sort((a, b) => {
                    // 定义年龄阶段的优先级
                    const getAgePriority = (id: string) => {
                        if (id.includes('Wyrmling')) return 0;
                        if (id.includes('Young')) return 1;
                        if (id.includes('Adult')) return 2;
                        if (id.includes('Ancient')) return 3;
                        return 99; // 其他情况放在最后
                    };
                    
                    // 比较年龄优先级
                    const priorityA = getAgePriority(a);
                    const priorityB = getAgePriority(b);
                    
                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }
                    
                    // 年龄阶段相同则按字母顺序排序
                    return a.localeCompare(b);
                });
                
                bestiaryData.bestiaries = sortedChildren;
            }
        }
    }

    // 处理怪物 fluff 数据中的特定格式文本
    private processFluffSections(data: any) {
        if (!data || !data.full) return data;

        // 处理英文和中文的 fluff 数据
        const languages = ['en', 'zh'];
        for (const lang of languages) {
            const fluff = data.full[lang];
            if (!fluff || !Array.isArray(fluff.entries)) continue;

            for (const section of fluff.entries) {
                if (section.type === 'section' && Array.isArray(section.entries) && section.entries.length >= 2) {
                    // 检查第一句是否是 {@i ...} 格式
                    const firstEntry = section.entries[0];
                    if (typeof firstEntry === 'string' && firstEntry.match(/^\{@i (.+)\}$/)) {
                        const sumMatch = firstEntry.match(/^\{@i (.+)\}$/);
                        if (sumMatch) {
                            const sum = sumMatch[1];

                            // 检查第二句是否是列表格式
                            const secondEntry = section.entries[1];
                            if (
                                secondEntry.type === 'list' &&
                                secondEntry.style === 'list-hang-notitle' &&
                                Array.isArray(secondEntry.items) &&
                                secondEntry.items.length >= 2
                            ) {
                                // 检查是否有栖息地和宝藏项
                                let habitat: string | undefined;
                                let treasure: string | undefined;

                                for (const item of secondEntry.items) {
                                    if (item.type === 'item') {
                                        // 检查栖息地项
                                        if (
                                            (item.name === 'Habitat:' || item.name === '栖息地') &&
                                            item.entry
                                        ) {
                                            habitat = item.entry;
                                        }
                                        // 检查宝藏项
                                        if (
                                            (item.name === 'Treasure:' || item.name === '宝藏：') &&
                                            item.entry
                                        ) {
                                            treasure = item.entry;
                                        }
                                    }
                                }

                                // 如果找到所有必要的字段，进行转换
                                if (sum && habitat && treasure) {
                                    section.sum = sum;
                                    section.habitat = habitat;
                                    section.treasure = treasure;
                                    
                                    // 从 entries 中移除前两个元素
                                    section.entries = section.entries.slice(2);
                                }
                            }
                        }
                    }
                }
            }
        }

        return data;
    }

    // 处理 alignment 文本生成
    private processAlignmentText(alignmentData: any, alignmentPrefix: string = ''): string {
        const alignmentMap: Record<string, string> = {
            'L,G': '守序善良',
            'L,E': '守序邪恶',
            'C,G': '混乱善良',
            'C,E': '混乱邪恶',
            'N,G': '中立善良',
            'N,E': '中立邪恶',
            'L,N': '守序中立',
            'C,N': '混乱中立',
            'N': '绝对中立',
            'U': '无阵营',
            'A': '任意阵营'
        };

        const OrTitle: Record<string, string> = {
            'zh': '或',
            'en': ' or '
        };

        // 提取alignment数组
        const alignmenttags = Array.isArray(alignmentData) 
            ? alignmentData 
            : (alignmentData?.alignment || []);
        const defaultPrefix = alignmentData?.alignmentPrefix || alignmentPrefix || '';

        let result = '';
        const ataglist: string[] = [];

        for (const atag of alignmenttags) {
            if (typeof atag === 'string') {
                const text = alignmentMap[atag] || atag;
                result += text;
            } else if (typeof atag === 'object' && atag !== null) {
                // 获取该标签的alignment数组
                const atagalignment = atag.alignment || [];
                const chance = atag.chance || 0;
                const atagalignmentPrefix = atag.alignmentPrefix || defaultPrefix;

                // 构建该标签的alignment文本
                let atagalignment_text = atagalignmentPrefix;
                const atagKey = Array.isArray(atagalignment) ? atagalignment.join(',') : (atagalignment || '');
                atagalignment_text += alignmentMap[atagKey] || atagKey;

                if (chance > 0) {
                    atagalignment_text += '（' + chance + '%）';
                }
                ataglist.push(atagalignment_text);
            }
        }

        if (ataglist.length > 0) {
            result = ataglist.join(OrTitle['zh']);
        }

        return result;
    }

    async generateFiles() {
        const outputDir = './output/bestiary';
        await fs.mkdir(outputDir, { recursive: true });
        const writtenFileNames = new Set<string>();

        for (const [id, bestiaryData] of this.db) {
            // 处理 fluff 数据中的特定格式文本
            const processedData = this.processFluffSections({ ...bestiaryData });

            // 处理 alignment 字段
            if (processedData.alignment) {
                // 构建 alignment 块
                const alignmentBlock: any = {
                    alignment: processedData.alignment
                };

                // 生成 alignmenttext
                alignmentBlock.alignmenttext = this.processAlignmentText(processedData.alignment);

                // 处理 alignmentPrefix
                if (processedData.en?.alignmentPrefix) {
                    alignmentBlock.alignmentPrefix = processedData.en.alignmentPrefix;
                    delete processedData.en.alignmentPrefix;
                }
                if (processedData.zh?.alignmentPrefix) {
                    delete processedData.zh.alignmentPrefix;
                }

                // 替换原有的 alignment 字段
                processedData.alignment = alignmentBlock;
            }

            // 处理 initiative 字段（参考render.js的getInitiativeBonusNumber和_getInitiativePassive逻辑）
            if (processedData.initiative !== undefined) {
                // 检查dex是否存在且没有special属性
                const dex = processedData.dex;
                
                if (typeof processedData.initiative === 'number') {
                    // 如果原始数据中initiative是数字，保持原样输出（如人工生命仆从）
                    // 不做任何处理
                } else if (typeof processedData.initiative === 'object') {
                    // 如果原始数据中initiative是对象
                    if (processedData.initiative.initiative !== undefined) {
                        // 如果initiative.initiative已有值，使用它计算average
                        if (dex !== undefined && !dex.special) {
                            const dexMod = Math.floor((dex - 10) / 2);
                            processedData.initiative.average = 10 + processedData.initiative.initiative;
                            // 如果有advantageMode，需要调整
                            if (processedData.initiative.advantageMode === 'adv') {
                                processedData.initiative.average += 5;
                            } else if (processedData.initiative.advantageMode === 'dis') {
                                processedData.initiative.average -= 5;
                            }
                        }
                    } else if (dex !== undefined && !dex.special) {
                        // 如果没有initiative.initiative，需要计算
                        // 计算熟练加值（使用正确的crToPb逻辑）
                        const getProficiencyBonus = (cr: number) => {
                            if (cr < 0) return null;
                            if (cr < 5) return 2;
                            return Math.ceil(cr / 4) + 1;
                        };
                        
                        const cr = processedData.cr || 0;
                        const proficiencyBonus = getProficiencyBonus(cr);
                        const dexMod = Math.floor((dex - 10) / 2);
                        
                        // 计算先攻加值
                        let initiativeMod = dexMod;
                        if (processedData.initiative.proficiency && cr < 100 && proficiencyBonus !== null) {
                            initiativeMod += processedData.initiative.proficiency * proficiencyBonus;
                        }
                        
                        // 计算先攻定值
                        let initiativeAverage = 10 + initiativeMod;
                        if (processedData.initiative.advantageMode === 'adv') {
                            initiativeAverage += 5;
                        } else if (processedData.initiative.advantageMode === 'dis') {
                            initiativeAverage -= 5;
                        }
                        
                        processedData.initiative.initiative = initiativeMod;
                        processedData.initiative.average = initiativeAverage;
                    }
                }
            } else {
                // 如果initiative未定义，且dex存在且没有special属性，生成initiative
                const dex = processedData.dex;
                if (dex !== undefined && !dex.special) {
                    const dexMod = Math.floor((dex - 10) / 2);
                    processedData.initiative = {
                        initiative: dexMod,
                        average: 10 + dexMod
                    };
                }
            }

            // 检查 navpills（已在数据加载后添加）
            const navpills = processedData.navpills;
            // 检查 isnavpill（从收集到的 ids 中检查）
            const isnavpill = isnavpillIds.has(id);
            // 提取 onlyfull 和 superiorfork
            const onlyfull = processedData.onlyfull;
            const superiorfork = processedData.superiorfork;

            // 调整字段顺序
            const displayName = processedData.displayName;
            const mainSource = processedData.mainSource;
            const allSources = processedData.allSources;
            const translator = processedData.translator;
            const full = processedData.full;

            delete processedData.displayName;
            delete processedData.mainSource;
            delete processedData.allSources;
            delete processedData.translator;
            delete processedData.full;
            delete processedData.onlyfull;
            delete processedData.superiorfork;
            delete processedData.navpills;

            // 重新构建对象，按新顺序放置字段
            const reorderedData: Record<string, any> = {};
            const keys = Object.keys(processedData);

            // 记录是否已经插入了需要移动的字段
            let insertedMovedFields = false;
            let insertedFullFields = false;

            for (const key of keys) {
                reorderedData[key] = processedData[key];
                // 在 page 字段后插入 displayName 等字段（仅插入一次）
                if (key === 'page' && !insertedMovedFields) {
                    if (displayName) reorderedData.displayName = displayName;
                    if (mainSource) reorderedData.mainSource = mainSource;
                    if (allSources) reorderedData.allSources = allSources;
                    if (translator !== undefined) reorderedData.translator = translator;
                    insertedMovedFields = true;
                }
                // 在 full 字段前插入 onlyfull、superiorfork、navpills、isnavpill
                if (key.startsWith('full') && !insertedFullFields) {
                    if (onlyfull) reorderedData.onlyfull = onlyfull;
                    if (superiorfork !== undefined) reorderedData.superiorfork = superiorfork;
                    if (navpills) reorderedData.navpills = true;
                    if (isnavpill) reorderedData.isnavpill = true;
                    insertedFullFields = true;
                }
            }

            // 如果没有 page 字段，则在最后插入 displayName 等字段
            if (!insertedMovedFields) {
                if (displayName) reorderedData.displayName = displayName;
                if (mainSource) reorderedData.mainSource = mainSource;
                if (allSources) reorderedData.allSources = allSources;
                if (translator !== undefined) reorderedData.translator = translator;
            }

            // 如果没有触发 full 字段的判断，则在最后插入 full 前的字段
            if (!insertedFullFields) {
                if (onlyfull) reorderedData.onlyfull = onlyfull;
                if (superiorfork !== undefined) reorderedData.superiorfork = superiorfork;
                if (navpills) reorderedData.navpills = true;
                if (isnavpill) reorderedData.isnavpill = true;
            }

            // 添加 full 字段
            if (full) reorderedData.full = full;

            const baseName = mwUtil.getMwTitle(
                reorderedData.displayName?.en || reorderedData.displayName?.zh || id
            );
            const sourceId = reorderedData.mainSource?.source || 'UNKNOWN';
            const preferredFileName = `bestiary_1_${sourceId}_1_${baseName}.json`;
            const fileName = resolveCaseInsensitiveOutputFileName(
                writtenFileNames,
                preferredFileName,
                id
            );
            if (fileName !== preferredFileName) {
                logger.log('BestiaryMgr', `怪物导出文件名冲突，改用去重文件名：${preferredFileName} -> ${fileName} (${id})`);
            }
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(reorderedData, null, 2), 'utf-8');
        }
    }
}

export const bestiaryMgr = new BestiaryMgr();

const readJson = async <T>(filePath: string): Promise<T> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
};

const loadBilingualFile = async <T>(relativePath: string): Promise<{ en: T; zh: T }> => {
    const enPath = path.join(config.DATA_EN_DIR, relativePath);
    const zhPath = path.join(config.DATA_ZH_DIR, relativePath);
    const [en, zh] = await Promise.all([readJson<T>(enPath), readJson<T>(zhPath)]);
    return { en, zh };
};

const loadIndexedSpellData = async (): Promise<{ en: SpellFile; zh: SpellFile }> => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'spells/index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'spells/index.json')),
    ]);

    const loadSpellSet = async (
        baseDir: string,
        indexMap: Record<string, string>
    ): Promise<SpellFile> => {
        const spell: SpellFileEntry[] = [];
        const files = Object.values(indexMap);
        for (const fileName of files) {
            const data = await readJson<SpellFile>(path.join(baseDir, 'spells', fileName));
            spell.push(...(data.spell || []));
        }
        return { spell };
    };

    const [en, zh] = await Promise.all([
        loadSpellSet(config.DATA_EN_DIR, enIndex),
        loadSpellSet(config.DATA_ZH_DIR, zhIndex),
    ]);
    return { en, zh };
};

const loadIndexedSpellFluffData = async (): Promise<{ en: SpellFluffFile; zh: SpellFluffFile }> => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'spells/fluff-index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'spells/fluff-index.json')),
    ]);

    const loadFluffSet = async (
        baseDir: string,
        indexMap: Record<string, string>
    ): Promise<SpellFluffFile> => {
        const spellFluff: SpellFluffEntry[] = [];
        const files = Object.values(indexMap);
        for (const fileName of files) {
            const data = await readJson<SpellFluffFile>(path.join(baseDir, 'spells', fileName));
            spellFluff.push(...(data.spellFluff || []));
        }
        return { spellFluff };
    };

    const [en, zh] = await Promise.all([
        loadFluffSet(config.DATA_EN_DIR, enIndex),
        loadFluffSet(config.DATA_ZH_DIR, zhIndex),
    ]);
    return { en, zh };
};

const loadIndexedBestiaryData = async (): Promise<{ en: MonsterFile; zh: MonsterFile }> => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'bestiary/index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'bestiary/index.json')),
    ]);

    const loadBestiarySet = async (
        baseDir: string,
        indexMap: Record<string, string>
    ): Promise<MonsterFile> => {
        const monster: MonsterFileEntry[] = [];
        for (const fileName of Object.values(indexMap)) {
            const data = await readJson<MonsterFile>(path.join(baseDir, 'bestiary', fileName));
            monster.push(...(data.monster || []));
        }
        return { monster };
    };

    const [en, zh] = await Promise.all([
        loadBestiarySet(config.DATA_EN_DIR, enIndex),
        loadBestiarySet(config.DATA_ZH_DIR, zhIndex),
    ]);
    return { en, zh };
};

const loadIndexedBestiaryFluffData = async (): Promise<{ en: MonsterFluffFile; zh: MonsterFluffFile }> => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'bestiary/fluff-index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'bestiary/fluff-index.json')),
    ]);

    const loadBestiaryFluffSet = async (
        baseDir: string,
        indexMap: Record<string, string>
    ): Promise<MonsterFluffFile> => {
        const monsterFluff: MonsterFluffEntry[] = [];
        for (const fileName of Object.values(indexMap)) {
            const data = await readJson<MonsterFluffFile>(path.join(baseDir, 'bestiary', fileName));
            monsterFluff.push(...(data.monsterFluff || []));
        }
        return { monsterFluff };
    };

    const [en, zh] = await Promise.all([
        loadBestiaryFluffSet(config.DATA_EN_DIR, enIndex),
        loadBestiaryFluffSet(config.DATA_ZH_DIR, zhIndex),
    ]);
    return { en, zh };
};

const printProgress = (message: string) => {
    console.log(chalk.cyan(`[prepareData] ${message}`));
};

// tbui-nav-pills 配置
interface TbuiNavPillsConfig {
    uids?: string[];
}

let tbuiNavPillsConfig: TbuiNavPillsConfig = {};
let isnavpillIds = new Set<string>();

(async () => {
    try {
        // 解析命令行参数
        const args = process.argv.slice(2);
        const generatePages = args.includes('--page');
        
        const startedAt = Date.now();
        printProgress('开始准备数据');
        await createOutputFolders(generatePages);
        printProgress('输出目录已重建');

        // 加载 tbui-nav-pills 配置
        try {
            tbuiNavPillsConfig = await readJson(path.join('config', 'tbui-nav-pills.json'));
            printProgress('tbui-nav-pills 配置已加载');
        } catch (error) {
            printProgress('未找到 tbui-nav-pills.json，将跳过 navpills 功能');
        }

        const [bookFiles, featFiles, itemBaseFiles, itemFiles, magicVariantFiles, itemFluffFiles] =
            await Promise.all([
                loadBilingualFile<BookFile>('books.json'),
                loadBilingualFile<FeatFile>('feats.json'),
                loadBilingualFile<ItemBaseFile>('items-base.json'),
                loadBilingualFile<ItemFile>('items.json'),
                loadBilingualFile<MagicVariantFile>('magicvariants.json'),
                loadBilingualFile<ItemFluffFile>('fluff-items.json'),
            ]);
        printProgress('基础 JSON 已加载');

        const [spellFiles, spellFluffFiles, bestiaryFiles, bestiaryFluffFiles] = await Promise.all([
            loadIndexedSpellData(),
            loadIndexedSpellFluffData(),
            loadIndexedBestiaryData(),
            loadIndexedBestiaryFluffData(),
        ]);
        await spellMgr.loadSources(path.join(config.DATA_EN_DIR, 'spells/sources.json'));
        printProgress(
            `法术与怪物索引已加载 (spell=${spellFiles.en.spell.length}, bestiary=${bestiaryFiles.en.monster.length})`
        );

        itemFluffMgr.loadData(itemFluffFiles.zh, itemFluffFiles.en);

        bookMgr.loadData(bookFiles.zh, bookFiles.en);

        featMgr.loadData(featFiles.zh, featFiles.en);

        itemPropertyMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);

        itemTypeMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);
        // 注意：itemTypeCollection.json 将在 baseItemMgr 加载完成后生成

        itemMasteryMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);

        baseItemMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);

        // 在 baseItemMgr 加载完成后，收集基础物品列表并生成 itemTypeCollection.json
        itemTypeMgr.collectBaseItems(baseItemMgr);

        itemMgr.loadData(itemFiles.zh, itemFiles.en);

        magicVariantMgr.loadData(magicVariantFiles.zh, magicVariantFiles.en);

        spellMgr.loadFluff(spellFluffFiles.zh, spellFluffFiles.en);
        spellMgr.loadData(spellFiles.zh, spellFiles.en);

        bestiaryMgr.loadFluff(bestiaryFluffFiles.zh, bestiaryFluffFiles.en);
        bestiaryMgr.loadData(bestiaryFiles.zh, bestiaryFiles.en);
        
        // 统一收集所有需要添加 navpills 和 isnavpill 的 id
        const navpillsUids = new Set(tbuiNavPillsConfig.uids || []);
        
        // 收集怪物相关
        for (const [id, data] of bestiaryMgr.db) {
            if (navpillsUids.has(data.uid)) {
                (data as any).navpills = true;
                if ((data as any).bestiaries) {
                    for (const bid of (data as any).bestiaries) {
                        isnavpillIds.add(bid);
                    }
                }
                if ((data as any).items) {
                    for (const iid of (data as any).items) {
                        isnavpillIds.add(iid);
                    }
                }
            }
        }
        
        // 收集基础物品相关
        for (const [id, data] of baseItemMgr.db) {
            if (navpillsUids.has(data.uid)) {
                (data as any).navpills = true;
                if ((data as any).items) {
                    for (const iid of (data as any).items) {
                        isnavpillIds.add(iid);
                    }
                }
            }
        }
        
        // 收集物品相关
        for (const [id, data] of itemMgr.db) {
            if (navpillsUids.has(data.uid)) {
                (data as any).navpills = true;
                if ((data as any).items) {
                    for (const iid of (data as any).items) {
                        isnavpillIds.add(iid);
                    }
                }
            }
        }
        
        // 收集魔法变体相关
        for (const [id, data] of magicVariantMgr.db) {
            if (navpillsUids.has(data.uid)) {
                (data as any).navpills = true;
                if ((data as any).items) {
                    for (const iid of (data as any).items) {
                        isnavpillIds.add(iid);
                    }
                }
            }
        }
        
        if (!generatePages) {
            // npm run start: 只生成基础数据到 output 目录
            await bookMgr.generateFiles();
            printProgress(`book 完成 (${bookMgr.db.size})`);

            await featMgr.generateFiles();
            printProgress(`feat 完成 (${featMgr.db.size})`);

            await itemPropertyMgr.generateFiles();
            printProgress(`itemProperty 完成 (${itemPropertyMgr.db.size})`);

            await itemMasteryMgr.generateFiles();
            printProgress(`itemMastery 完成 (${itemMasteryMgr.db.size})`);

            await baseItemMgr.generateFiles();
            printProgress(`baseItem 完成 (${baseItemMgr.db.size})`);

            await itemTypeMgr.generateFiles();
            printProgress(`itemType 完成 (${itemTypeMgr.db.size})`);

            await itemMgr.generateFiles();
            printProgress(`item 完成 (${itemMgr.db.size})`);

            await magicVariantMgr.generateFiles();
            printProgress(`magicVariant 完成 (${magicVariantMgr.db.size})`);

            await spellMgr.generateFiles();
            printProgress(`spell 完成 (${spellMgr.db.size})`);

            await bestiaryMgr.generateFiles();
            printProgress(`bestiary 完成 (${bestiaryMgr.db.size})`);

            const namelistDir = path.join('./output', 'namelist');
            await fs.mkdir(namelistDir, { recursive: true });

            await generateSourcesJson(
                bookMgr,
                featMgr,
                spellMgr,
                baseItemMgr,
                itemMgr,
                magicVariantMgr,
                bestiaryMgr,
                namelistDir
            );

            // 合并所有物品数据（基础物品、普通物品、变体物品）
            const allItems = [
                ...Array.from(baseItemMgr.db.values()),
                ...Array.from(itemMgr.db.values()),
                ...Array.from(magicVariantMgr.db.values())
            ];
            await generateCollectionNameList('item', allItems, namelistDir);

            // 生成法术名称列表
            await generateCollectionNameList('spell', Array.from(spellMgr.db.values()), namelistDir);

            // 生成怪物名称列表
            await generateCollectionNameList('bestiary', Array.from(bestiaryMgr.db.values()), namelistDir);

            await idMgr.generateFiles();
            await tagParser.generateFiles();
            await logger.generateFile();
            await processGeneratedFiles();
        } else {
            // npm run page: 只生成 wiki 页面到 output_page 目录
            const wikiPageGenerator = new WikiPageGenerator({
                books: bookFiles,
                spells: spellMgr.db,
                baseItems: baseItemMgr.db,
                items: itemMgr.db,
                magicVariants: magicVariantMgr.db,
                logger: message => printProgress(`wikiPage: ${message}`),
            });
            const wikiPageResult = await wikiPageGenerator.generateAll();
            printProgress(
                `wikiPage 完成 (spellFiles=${wikiPageResult.spellFiles}, itemFiles=${wikiPageResult.itemFiles}, failed=${wikiPageResult.failed}, skippedSelfRedirects=${wikiPageResult.skippedSelfRedirects}, pageConflicts=${wikiPageResult.pageConflicts})`
            );
        }

        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
        console.log(
            chalk.green(
                `[prepareData] 完成，用时 ${elapsedSec}s，输出: book=${bookMgr.db.size}, feat=${featMgr.db.size}, item(base=${baseItemMgr.db.size}, normal=${itemMgr.db.size}, variant=${magicVariantMgr.db.size}), spell=${spellMgr.db.size}, bestiary=${bestiaryMgr.db.size}`
            )
        );
    } catch (error) {
        console.error(chalk.red('[prepareData] 执行失败'), error);
        process.exitCode = 1;
    }
})();

async function processGeneratedFiles() {
    printProgress('开始处理 generated 文件夹');
    const enGeneratedDir = path.join(config.DATA_EN_DIR, 'generated');
    const zhGeneratedDir = path.join(config.DATA_ZH_DIR, 'generated');
    const outputDir = path.join('./output', 'generated');

    // 读取英文generated文件夹中的文件
    let enFiles;
    try {
        enFiles = await fs.readdir(enGeneratedDir);
    } catch (error) {
        console.error('读取英文generated文件夹失败:', error);
        return;
    }
    const jsonEnFiles = enFiles.filter(file => file.endsWith('.json'));

    // 读取中文generated文件夹中的文件
    let zhFiles;
    try {
        zhFiles = await fs.readdir(zhGeneratedDir);
    } catch (error) {
        console.error('读取中文generated文件夹失败:', error);
        return;
    }
    const jsonZhFiles = zhFiles.filter(file => file.endsWith('.json'));

    // 处理英文JSON文件
    for (const file of jsonEnFiles) {
        const inputPath = path.join(enGeneratedDir, file);
        
        try {
            const data = await fs.readFile(inputPath, 'utf-8');
            const parsedData = JSON.parse(data);
            
            // 特殊处理 gendata-tables.json 文件
            if (file === 'gendata-tables.json' && parsedData.table && Array.isArray(parsedData.table)) {
                await processTablesFile(parsedData.table, 'en');
            } else {
                // 普通文件处理
                const outputPath = path.join(outputDir, `${path.parse(file).name}-en.json`);
                const formattedData = JSON.stringify(parsedData, null, 2);
                await fs.writeFile(outputPath, formattedData, 'utf-8');
            }
        } catch (error) {
            console.error(`处理英文文件失败: ${file}`, error);
        }
    }

    // 处理中文JSON文件
    for (const file of jsonZhFiles) {
        const inputPath = path.join(zhGeneratedDir, file);
        
        try {
            const data = await fs.readFile(inputPath, 'utf-8');
            const parsedData = JSON.parse(data);
            
            // 特殊处理 gendata-tables.json 文件
            if (file === 'gendata-tables.json' && parsedData.table && Array.isArray(parsedData.table)) {
                await processTablesFile(parsedData.table, 'zh');
            } else {
                // 普通文件处理
                const outputPath = path.join(outputDir, file);
                const formattedData = JSON.stringify(parsedData, null, 2);
                await fs.writeFile(outputPath, formattedData, 'utf-8');
            }
        } catch (error) {
            console.error(`处理中文文件失败: ${file}`, error);
        }
    }

    printProgress('generated 文件夹处理完成');
}

// 处理表格文件，将表格按照 source 和 name 分割输出
async function processTablesFile(tables: any[], language: 'en' | 'zh') {
    const tablesOutputDir = path.join('./output', 'generated', 'tables', language);
    await fs.mkdir(tablesOutputDir, { recursive: true });
    
    for (const table of tables) {
        if (!table.source || !table.name) {
            console.warn('表格缺少source或name字段，跳过:', table);
            continue;
        }
        
        // 清理文件名中的非法字符
        const sanitizeFileName = (name: string): string => {
            // Windows非法字符: < > : " / \ | ? *
            return name.replace(/[<>:"/\\|?*]/g, '_');
        };
        
        // 生成文件名：tables_1_来源_1_表格名.json
        const safeName = sanitizeFileName(table.name);
        const fileName = `tables_1_${table.source}_1_${safeName}.json`;
        const outputPath = path.join(tablesOutputDir, fileName);
        
        try {
            // 添加 dataType 字段
            const tableWithDataType = {
                dataType: 'table',
                ...table
            };
            const formattedData = JSON.stringify(tableWithDataType, null, 2);
            await fs.writeFile(outputPath, formattedData, 'utf-8');
        } catch (error) {
            console.error(`处理表格失败: ${fileName}`, error);
        }
    }
}
