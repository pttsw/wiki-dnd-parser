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
    MagicVariantEntry,
    MagicVariantFile,
    ItemProperty,
    ItemType,
    WikiItemData,
    WikiItemPropertyData,
    WikiItemTypeData,
} from './types/items';
import { parseContent } from './contentGen.js';
import { mwUtil } from './config.js';
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

const mergeLocalized = <T>(en: T, zh?: Partial<T> | null): T => {
    if (!zh) return en;
    if (Array.isArray(en) || Array.isArray(zh)) {
        return (zh ?? en) as T;
    }
    if (
        en &&
        typeof en === 'object' &&
        zh &&
        typeof zh === 'object' &&
        !Array.isArray(en) &&
        !Array.isArray(zh)
    ) {
        const result: any = { ...(en as any) };
        for (const [key, zhValue] of Object.entries(zh)) {
            if (zhValue === undefined) continue;
            const enValue = (en as any)[key];
            if (
                enValue &&
                typeof enValue === 'object' &&
                !Array.isArray(enValue) &&
                zhValue &&
                typeof zhValue === 'object' &&
                !Array.isArray(zhValue)
            ) {
                result[key] = mergeLocalized(enValue, zhValue as any);
            } else {
                result[key] = zhValue;
            }
        }
        return result as T;
    }
    return (zh ?? en) as T;
};

const buildWeaponBlock = (item: ItemFileEntry | ItemGroup) => {
    const raw = item as ItemFileEntry;
    const hasKey = (key: keyof ItemFileEntry) => raw[key] !== undefined;
    const boolKeys: (keyof ItemFileEntry)[] = [
        'firearm',
        'sword',
        'rapier',
        'crossbow',
        'axe',
        'staff',
        'club',
        'spear',
        'dagger',
        'hammer',
        'bow',
        'mace',
        'polearm',
        'lance',
    ];
    const keysToCheck: (keyof ItemFileEntry)[] = [
        'weaponCategory',
        'dmg1',
        'dmg2',
        'dmgType',
        'range',
        'reload',
        'ammoType',
        'property',
        'mastery',
        'packContents',
        ...boolKeys,
    ];
    const shouldBuild = keysToCheck.some(key => hasKey(key));
    if (!shouldBuild) return undefined;

    const weaponBlock: any = {};
    if (raw.weaponCategory) {
        weaponBlock.category = raw.weaponCategory;
        weaponBlock.weaponCategory = raw.weaponCategory;
    }
    if (hasKey('dmg1')) weaponBlock.dmg1 = raw.dmg1;
    if (hasKey('dmg2')) weaponBlock.dmg2 = raw.dmg2;
    if (hasKey('dmgType')) weaponBlock.dmgType = raw.dmgType;
    const dmgs = [raw.dmg1, raw.dmg2].filter(d => d !== undefined) as string[];
    if (dmgs.length > 0) weaponBlock.dmgs = dmgs;
    if (raw.range) {
        const [min, max] = raw.range.split('/');
        weaponBlock.range = { min: Number(min), max: Number(max) };
    }
    if (hasKey('reload')) weaponBlock.reload = raw.reload;
    if (hasKey('ammoType')) weaponBlock.ammoType = raw.ammoType;
    if (hasKey('property')) weaponBlock.property = raw.property;
    if (hasKey('mastery')) weaponBlock.mastery = raw.mastery;
    if (hasKey('packContents')) weaponBlock.packContents = raw.packContents;
    for (const key of boolKeys) {
        if (hasKey(key)) weaponBlock[key] = raw[key];
    }
    return weaponBlock;
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

            const enEntries = enItem.entries ?? [];
            const zhMerged = zhItem ? mergeLocalized(enItem, zhItem) : null;
            const zhEntries = zhMerged?.entries ?? enEntries;

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id}`,
                id: id,
                weight: enItem.weight,
                value: enItem.value || undefined,
                rarity: enItem.rarity,
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
                zh: zhMerged
                    ? {
                        ...zhMerged,
                        entries: zhEntries,
                        html: parseContent(zhEntries),
                    }
                    : null,
                en: {
                    ...enItem,
                    entries: enEntries,
                    html: parseContent(enEntries),
                },
                weapon: buildWeaponBlock(enItem),
                armor: enItem.armor
                    ? {
                        ac: enItem.ac,
                        maxDexterty: enItem.dexterityMax === null ? true : false,
                    }
                    : undefined,
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
        const isItemGroup = (
            item: ItemFileEntry | ItemGroup
        ): item is ItemGroup => Array.isArray((item as ItemGroup).items);

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
        for (const enItem of enItems) {
            const id = this.getId(enItem);

            const zhItem = zhItems.find(i => this.getId(i) === id);
            if (!zhItem) {
                logger.log('ItemMgr', `${id}: 未找到中文版本的物品：${enItem.name} `);
            }
            let baseItem: ItemFileEntry | undefined;
            if (enItem.baseItem?.includes('|')) {
                const [baseId, source] = enItem.baseItem.split('|').map(s => s.trim());
                baseItem = this.baseItems.raw.en?.baseitem.find(
                    i =>
                        i.name.toLowerCase() === baseId.toLowerCase() &&
                        i.source.toLowerCase() === source.toLowerCase()
                );
            } else {
                baseItem = this.baseItems.raw.en?.baseitem.find(
                    i => i.name.toLowerCase() === enItem.baseItem?.toLowerCase()
                );
            }

            // 收集所有相关版本
            const relatedVersions = new Set<string>();
            normalizeReprintedAs(enItem.reprintedAs).forEach(t => relatedVersions.add(t));
            this.reprintMap.get(id)?.forEach(s => relatedVersions.add(s));

            const groupItems = isItemGroup(enItem)
                ? zhItem && isItemGroup(zhItem)
                    ? zhItem.items
                    : enItem.items
                : undefined;

            const allSources = buildAllSources(collectRelatedIds(id));

            const enEntries = enItem.entries ?? [];
            const zhMerged = zhItem ? mergeLocalized(enItem, zhItem) : null;
            const zhEntries = zhMerged?.entries ?? enEntries;

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id} `,
                id: id,
                weight: enItem.weight,
                value: enItem.value || undefined,
                rarity: enItem.rarity,
                isBaseItem: false,
                full: itemFluffMgr.getFull(id),
                baseItem: enItem.baseItem || '',
                items: groupItems,
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
                zh: zhMerged
                    ? {
                        ...zhMerged,
                        entries: zhEntries,
                        html: parseContent(zhEntries),
                    }
                    : null,
                en: {
                    ...enItem,
                    entries: enEntries,
                    html: parseContent(enEntries),
                },

                weapon: buildWeaponBlock(enItem),
                armor: enItem.armor
                    ? {
                        ac: enItem.ac,
                        maxDexterty: enItem.dexterityMax === null ? true : false,
                    }
                    : undefined,
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

    constructor() { }

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

            const enEntries = this.getEntries(enItem) ?? [];
            const zhMerged = zhItem ? mergeLocalized(enItem, zhItem) : null;
            const zhEntries = zhMerged
                ? this.getEntries(zhMerged) ?? enEntries
                : enEntries;

            const itemData: WikiItemData = {
                dataType: 'item',
                uid: `item_${id}`,
                id: id,
                rarity: enItem.inherits?.rarity || enItem.rarity,
                isBaseItem: false,
                displayName: {
                    zh: (() => {
                        if (!zhItem) return null;
                        if (zhItem.name.trim() === enItem.name.trim()) return null;
                        return zhItem.name;
                    })(),
                    en: enItem.name,
                },
                mainSource: {
                    source,
                    page: enItem.inherits?.page || enItem.page || 0,
                },
                allSources,
                relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
                zh: zhMerged
                    ? {
                        ...zhMerged,
                        entries: zhEntries,
                        html: parseContent(zhEntries),
                    }
                    : null,
                en: {
                    ...enItem,
                    entries: enEntries,
                    html: parseContent(enEntries),
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
export const magicVariantMgr = new MagicVariantMgr();

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
            const enEntries = enSpell.entries ?? [];
            const zhMerged = zhSpell ? mergeLocalized(enSpell, zhSpell) : null;
            const zhEntries = zhMerged?.entries ?? enEntries;

            const spellData: WikiSpellData = {
                dataType: 'spell',
                uid: `spell_${id}`,
                id: id,
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
                en: {
                    ...enSpell,
                    entries: enEntries,
                    html: parseContent(enEntries),
                },
                zh: zhMerged
                    ? {
                        ...zhMerged,
                        entries: zhEntries,
                        html: parseContent(zhEntries),
                    }
                    : null,
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
