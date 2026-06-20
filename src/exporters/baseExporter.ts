import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent } from '../contentGen.js';
import { buildFluffStore } from './fluff.js';
import {
    appendEnglishShadowFields,
    buildAllSources,
    buildReprintMap,
    collectRelatedIds,
    escapeFileName,
    extractTranslator,
    getDefaultId,
    normalizeReprintedAs,
    resolveCaseInsensitiveOutputFileName,
    splitStructuredRecordByDiff,
} from './shared.js';

export interface ExportItem {
    dataType: string;
    uid: string;
    id: string;
    displayName: {
        zh: string | null;
        en: string;
    };
    mainSource: {
        source: string;
        page: number;
    };
    [key: string]: any;
}

export interface BaseExporterConfig {
    dataType: string;
    dataFile: string;
    dataKey: string;
    fluffFile?: string;
    fluffKey?: string;
    appendEnglishShadow?: boolean;
    customBuildEntity?: (
        enItem: Record<string, any>,
        zhItem: Record<string, any> | null | undefined,
        entryMap: Map<string, Record<string, any>>,
        reprintMap: Map<string, string[]>,
        full: { en?: any; zh?: any } | undefined,
        fluffStore: ReturnType<typeof buildFluffStore> | undefined
    ) => Record<string, any>;
}

const readJson = async <T>(filePath: string): Promise<T> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
};

const loadBilingualFileCached = async (
    relativePath: string,
    cache: Map<string, { en: Record<string, any>; zh: Record<string, any> }>
) => {
    const cached = cache.get(relativePath);
    if (cached) return cached;

    const enPath = path.join(config.DATA_EN_DIR, relativePath);
    const zhPath = path.join(config.DATA_ZH_DIR, relativePath);
    const [en, zh] = await Promise.all([
        readJson<Record<string, any>>(enPath),
        readJson<Record<string, any>>(zhPath),
    ]);
    const next = { en, zh };
    cache.set(relativePath, next);
    return next;
};

const applyEntriesHtml = (
    block: Record<string, any>,
    dataType: string,
    id: string,
    locale: 'en' | 'zh'
) => {
    if (!block || block.entries === undefined) return;
    try {
        if (Array.isArray(block.entries)) {
            block.html = parseContent(block.entries);
        } else if (block.entries === '') {
            block.html = '';
        }
    } catch {
        console.log(`[BaseExporter] ${dataType}:${id}:${locale} 生成 html 失败`);
    }
};

const getDisplayName = (
    enItem: Record<string, any>,
    zhItem?: Record<string, any> | null
) => ({
    zh:
        zhItem && typeof zhItem.name === 'string' && zhItem.name.trim() !== enItem.name.trim()
            ? zhItem.name
            : null,
    en: enItem.name,
});

const defaultBuildEntity = (
    dataType: string,
    appendEnglishShadow: boolean
) => (
    enItem: Record<string, any>,
    zhItem: Record<string, any> | null | undefined,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>,
    full: { en?: any; zh?: any } | undefined,
    _fluffStore: ReturnType<typeof buildFluffStore> | undefined
) => {
    const id = getDefaultId(enItem);
    const split = splitStructuredRecordByDiff(enItem, zhItem, {
        emptyZhValue: '',
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    applyEntriesHtml(enOut, dataType, id, 'en');
    applyEntriesHtml(zhOut, dataType, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);
    // 取消将英文内容添加到 zh 对象中的功能
    // if (appendEnglishShadow) {
    //     appendEnglishShadowFields(zhOut, enOut);
    // }

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    return {
        dataType,
        uid: `${dataType}_${id}`,
        id,
        ...common,
        source: enItem.source,
        page: enItem.page || 0,
        translator,
        displayName: getDisplayName(enItem, zhItem),
        mainSource: {
            source: enItem.source,
            page: enItem.page || 0,
        },
        allSources: buildAllSources(collectRelatedIds(id, entryMap, reprintMap), entryMap),
        relatedVersions: relatedVersions.size > 0 ? [...relatedVersions] : undefined,
        full,
        zh: Object.keys(zhOut).length > 0 ? zhOut : null,
        en: enOut,
    };
};

export class BaseExporter {
    private config: BaseExporterConfig;
    private fileCache: Map<string, { en: Record<string, any>; zh: Record<string, any> }>;

    constructor(config: BaseExporterConfig) {
        this.config = config;
        this.fileCache = new Map();
    }

    async loadData(): Promise<{
        enEntries: Record<string, any>[];
        zhEntries: Record<string, any>[];
        fluffStore: ReturnType<typeof buildFluffStore> | undefined;
    }> {
        const { dataFile, dataKey, fluffFile, fluffKey } = this.config;

        const bilingual = await loadBilingualFileCached(dataFile, this.fileCache);
        const enEntries = Array.isArray(bilingual.en?.[dataKey]) ? [...bilingual.en[dataKey]] : [];
        const zhEntries = Array.isArray(bilingual.zh?.[dataKey]) ? [...bilingual.zh[dataKey]] : [];

        let fluffStore: ReturnType<typeof buildFluffStore> | undefined;
        if (fluffFile && fluffKey) {
            const fluffBilingual = await loadBilingualFileCached(fluffFile, this.fileCache);
            fluffStore = buildFluffStore(
                Array.isArray(fluffBilingual.zh?.[fluffKey]) ? fluffBilingual.zh[fluffKey] : [],
                Array.isArray(fluffBilingual.en?.[fluffKey]) ? fluffBilingual.en[fluffKey] : []
            );
        }

        return { enEntries, zhEntries, fluffStore };
    }

    buildEntryMaps(enEntries: Record<string, any>[], zhEntries: Record<string, any>[]) {
        const seenEn = new Map<string, Record<string, any>>();
        for (const entry of enEntries) {
            const id = getDefaultId(entry);
            if (!seenEn.has(id)) {
                seenEn.set(id, entry);
            }
        }

        const seenZh = new Map<string, Record<string, any>>();
        for (const entry of zhEntries) {
            const id = getDefaultId(entry);
            if (!seenZh.has(id)) {
                seenZh.set(id, entry);
            }
        }

        return { seenEn, seenZh };
    }

    buildOutputData(
        enEntries: Record<string, any>[],
        zhEntries: Record<string, any>[],
        fluffStore: ReturnType<typeof buildFluffStore> | undefined
    ): Record<string, any>[] {
        const { dataType, appendEnglishShadow = true, customBuildEntity } = this.config;
        const buildEntityFn = customBuildEntity || defaultBuildEntity(dataType, appendEnglishShadow);

        const { seenEn, seenZh } = this.buildEntryMaps(enEntries, zhEntries);
        const reprintMap = buildReprintMap(enEntries, getDefaultId);

        const outputData: Record<string, any>[] = [];
        for (const enItem of enEntries) {
            const id = getDefaultId(enItem);
            const zhItem = seenZh.get(id);
            const full = fluffStore?.getFull(id);
            outputData.push(buildEntityFn(enItem, zhItem, seenEn, reprintMap, full, fluffStore));
        }

        return outputData;
    }

    async writeOutputFiles(outputData: Record<string, any>[], outputDir: string): Promise<void> {
        await fs.mkdir(outputDir, { recursive: true });
        const writtenFileNames = new Map<string, Set<string>>();

        for (const item of outputData) {
            const sourceId = item.mainSource.source;
            const sourceDir = path.join(outputDir, sourceId);
            await fs.mkdir(sourceDir, { recursive: true });

            const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
            const preferredFileName = `${baseName}.json`;

            if (!writtenFileNames.has(sourceId)) {
                writtenFileNames.set(sourceId, new Set<string>());
            }
            const usedNames = writtenFileNames.get(sourceId)!;

            const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
            const filePath = path.join(sourceDir, fileName);
            await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
        }
    }

    async generateNameList(outputData: Record<string, any>[], typeName: string): Promise<void> {
        const namelistDir = path.join('./output', 'namelist');
        await fs.mkdir(namelistDir, { recursive: true });

        const namelistData = outputData.map(item => ({
            id: item.id || '',
            src: item.mainSource?.source || '',
            name_en: item.displayName?.en || '',
            name_zh: item.displayName?.zh || item.displayName?.en || ''
        }));

        const output = {
            type: typeName,
            data: namelistData
        };

        const outputPath = path.join(namelistDir, `${typeName}namelist.json`);
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        console.log(`已生成 ${typeName}namelist.json 文件：${outputPath}`);
    }

    async run(): Promise<{ count: number }> {
        const { dataType } = this.config;
        const outputDir = path.join('./output', dataType);

        const { enEntries, zhEntries, fluffStore } = await this.loadData();
        const outputData = this.buildOutputData(enEntries, zhEntries, fluffStore);
        
        await this.writeOutputFiles(outputData, outputDir);
        await this.generateNameList(outputData, dataType);

        return { count: outputData.length };
    }
}
