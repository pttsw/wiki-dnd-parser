import {
    BookContents,
    BookFile,
    BookFileEntry,
    BookHeader,
    WikiBookData,
    WikiBookEntry,
} from './types/books';
import { promises as fs } from 'fs';
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

export const createOutputFolders = async () => {
    // delete ./output folder and all files
    try {
        await fs.access('./output');
        await fs.rm('./output', { recursive: true, force: true });
    } catch (error) {
        // do nothing, folder does not exist
    }
    const dirs = ['collection', 'item', 'spell'];
    for (const dir of dirs) {
        const dirPath = path.join('./output', dir);
        try {
            await fs.access(dirPath);
        } catch (error) {
            await fs.mkdir(dirPath, { recursive: true });
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
    async generateFiles() {
        const outputPath = './output/collection/itemTypeCollection.json';
        try {
            await fs.access(outputPath);
            await fs.unlink(outputPath);
        } catch (error) {
            // do nothing, file does not exist
        }
        const output = {
            type: 'itemTypeCollection',
            data: Array.from(this.db.values()),
        };
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
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

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id}`,
                id: id,
                ...common,
                translator,
                isBaseItem: true,
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
            const fileName = `item_1_${itemData.mainSource.source}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(itemData, null, 2), 'utf-8');
            //     console.log(`已生成物品文件：${ filePath } `);
        }
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

        const parentByChild = new Map<string, string>();
        for (const group of en.itemGroup || []) {
            const parentId = this.getId(group);
            for (const childId of group.items || []) {
                if (!parentByChild.has(childId)) {
                    parentByChild.set(childId, parentId);
                }
            }
        }

        const getTopSuperior = (id: string): string | undefined => {
            const firstParent = parentByChild.get(id);
            if (!firstParent) return undefined;
            const visited = new Set<string>([id]);
            let current = firstParent;
            while (parentByChild.has(current) && !visited.has(current)) {
                visited.add(current);
                current = parentByChild.get(current)!;
            }
            return current;
        };

        // 第二遍：生成数据
        for (const enItem of enItems) {
            const id = this.getId(enItem);
            const origin = parentByChild.get(id);
            const superior = getTopSuperior(id);

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

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id} `,
                id: id,
                ...common,
                translator,
                isBaseItem: false,
                origin,
                superior,
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
            const fileName = `item_1_${itemData.mainSource.source}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(itemData, null, 2), 'utf-8');
        }
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

        return {
            dataType: 'item',
            uid: `item_${opts.id}`,
            id: opts.id,
            ...common,
            translator,
            rarity: opts.rarity ?? enItem.rarity,
            isBaseItem: false,
            origin: opts.origin,
            superior: opts.superior,
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

    private getParentByChildMap(): Map<string, string> {
        const parentByChild = new Map<string, string>();
        if (!this.items.raw.en) return parentByChild;
        const enItems = [...(this.items.raw.en.item || []), ...(this.items.raw.en.itemGroup || [])];
        for (const parent of enItems) {
            const parentId = this.items.getId(parent);
            const children = (parent as ItemGroup).items || [];
            for (const childId of children) {
                if (!parentByChild.has(childId)) {
                    parentByChild.set(childId, parentId);
                }
            }
        }
        return parentByChild;
    }

    private getTopSuperior(id: string, parentByChild: Map<string, string>): string | undefined {
        const firstParent = parentByChild.get(id);
        if (!firstParent) return undefined;
        const visited = new Set<string>([id]);
        let current = firstParent;
        while (parentByChild.has(current) && !visited.has(current)) {
            visited.add(current);
            current = parentByChild.get(current)!;
        }
        return current;
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
        const parentByChild = this.getParentByChildMap();
        const occupiedIds = new Set<string>([
            ...this.baseItems.db.keys(),
            ...this.items.db.keys(),
        ]);
        const templateSuperiorMap = new Map<string, string | undefined>();

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
            const directParent = parentByChild.get(id);
            const topSuperior = this.getTopSuperior(id, parentByChild);

            const templateData = this.buildVariantItemData(enItem, zhItem, {
                id,
                source,
                page: enItem.inherits?.page || enItem.page || 0,
                allSources,
                relatedVersions,
                rarity: enItem.inherits?.rarity || enItem.rarity,
                origin: directParent,
                superior: topSuperior,
            });
            this.db.set(id, templateData);
            occupiedIds.add(id);
            templateSuperiorMap.set(id, topSuperior);

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
                const derivedData = this.buildVariantItemData(mergedEn, mergedZh, {
                    id: derivedId,
                    source,
                    page,
                    allSources: derivedAllSources,
                    relatedVersions: new Set<string>([id]),
                    rarity: mergedEn.rarity,
                    origin: id,
                    superior: templateSuperior || id,
                    full: this.baseItems.db.get(baseId)?.full,
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
            const fileName = `item_1_${itemData.mainSource.source}_1_${baseName}.json`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(itemData, null, 2), 'utf-8');
        }
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

const printProgress = (message: string) => {
    console.log(chalk.cyan(`[prepareData] ${message}`));
};

(async () => {
    try {
        const startedAt = Date.now();
        printProgress('开始准备数据');
        await createOutputFolders();
        printProgress('输出目录已重建');

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

        const [spellFiles, spellFluffFiles] = await Promise.all([
            loadIndexedSpellData(),
            loadIndexedSpellFluffData(),
        ]);
        await spellMgr.loadSources(path.join(config.DATA_EN_DIR, 'spells/sources.json'));
        printProgress('法术索引与来源映射已加载');

        itemFluffMgr.loadData(itemFluffFiles.zh, itemFluffFiles.en);

        bookMgr.loadData(bookFiles.zh, bookFiles.en);
        await bookMgr.generateFiles();
        printProgress(`book 完成 (${bookMgr.db.size})`);

        featMgr.loadData(featFiles.zh, featFiles.en);
        await featMgr.generateFiles();
        printProgress(`feat 完成 (${featMgr.db.size})`);

        itemPropertyMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);
        await itemPropertyMgr.generateFiles();
        printProgress(`itemProperty 完成 (${itemPropertyMgr.db.size})`);

        itemTypeMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);
        await itemTypeMgr.generateFiles();
        printProgress(`itemType 完成 (${itemTypeMgr.db.size})`);

        itemMasteryMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);
        await itemMasteryMgr.generateFiles();
        printProgress(`itemMastery 完成 (${itemMasteryMgr.db.size})`);

        baseItemMgr.loadData(itemBaseFiles.zh, itemBaseFiles.en);
        await baseItemMgr.generateFiles();
        printProgress(`baseItem 完成 (${baseItemMgr.db.size})`);

        itemMgr.loadData(itemFiles.zh, itemFiles.en);
        await itemMgr.generateFiles();
        printProgress(`item 完成 (${itemMgr.db.size})`);

        magicVariantMgr.loadData(magicVariantFiles.zh, magicVariantFiles.en);
        await magicVariantMgr.generateFiles();
        printProgress(`magicVariant 完成 (${magicVariantMgr.db.size})`);

        spellMgr.loadFluff(spellFluffFiles.zh, spellFluffFiles.en);
        spellMgr.loadData(spellFiles.zh, spellFiles.en);
        await spellMgr.generateFiles();
        printProgress(`spell 完成 (${spellMgr.db.size})`);

        await idMgr.generateFiles();
        await tagParser.generateFiles();
        await logger.generateFile();

        const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
        console.log(
            chalk.green(
                `[prepareData] 完成，用时 ${elapsedSec}s，输出: book=${bookMgr.db.size}, feat=${featMgr.db.size}, item(base=${baseItemMgr.db.size}, normal=${itemMgr.db.size}, variant=${magicVariantMgr.db.size}), spell=${spellMgr.db.size}`
            )
        );
    } catch (error) {
        console.error(chalk.red('[prepareData] 执行失败'), error);
        process.exitCode = 1;
    }
})();
