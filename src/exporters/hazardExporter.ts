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
    extractTranslator,
    getDefaultId,
    normalizeReprintedAs,
    resolveCaseInsensitiveOutputFileName,
    splitStructuredRecordByDiff,
} from './shared.js';

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
        console.log(`[HazardExporter] ${dataType}:${id}:${locale} 生成 html 失败`);
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

const buildEntity = (
    enItem: Record<string, any>,
    zhItem: Record<string, any> | null | undefined,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>,
    full: { en?: any; zh?: any } | undefined,
    fluffStore: ReturnType<typeof buildFluffStore> | undefined
) => {
    const id = getDefaultId(enItem);
    const split = splitStructuredRecordByDiff(enItem, zhItem, {
        emptyZhValue: '',
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    applyEntriesHtml(enOut, 'hazard', id, 'en');
    applyEntriesHtml(zhOut, 'hazard', id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);
    appendEnglishShadowFields(zhOut, enOut);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    return {
        dataType: 'hazard',
        uid: `hazard_${id}`,
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

export interface HazardExporterResult {
    count: number;
}

export const runHazardExporter = async (): Promise<HazardExporterResult> => {
    const fileCache = new Map<string, { en: Record<string, any>; zh: Record<string, any> }>();
    
    const bilingual = await loadBilingualFileCached('trapshazards.json', fileCache);
    const enRawEntries = Array.isArray(bilingual.en?.hazard) ? [...bilingual.en.hazard] : [];
    const zhRawEntries = Array.isArray(bilingual.zh?.hazard) ? [...bilingual.zh.hazard] : [];

    const seenEn = new Map<string, Record<string, any>>();
    for (const entry of enRawEntries) {
        const id = getDefaultId(entry);
        if (!seenEn.has(id)) {
            seenEn.set(id, entry);
        }
    }

    const seenZh = new Map<string, Record<string, any>>();
    for (const entry of zhRawEntries) {
        const id = getDefaultId(entry);
        if (!seenZh.has(id)) {
            seenZh.set(id, entry);
        }
    }

    const fluffBilingual = await loadBilingualFileCached('fluff-trapshazards.json', fileCache);
    const fluffStore = buildFluffStore(
        Array.isArray(fluffBilingual.zh?.hazardFluff) ? fluffBilingual.zh.hazardFluff : [],
        Array.isArray(fluffBilingual.en?.hazardFluff) ? fluffBilingual.en.hazardFluff : []
    );

    const reprintMap = buildReprintMap(enRawEntries, getDefaultId);
    const outputData: Record<string, any>[] = [];

    for (const enItem of enRawEntries) {
        const id = getDefaultId(enItem);
        const zhItem = seenZh.get(id);
        const full = fluffStore?.getFull(id);
        outputData.push(buildEntity(enItem, zhItem, seenEn, reprintMap, full, fluffStore));
    }

    const outputDir = path.join('./output', 'hazard');
    await fs.mkdir(outputDir, { recursive: true });
    const writtenFileNames = new Map<string, Set<string>>();

    for (const item of outputData) {
        const sourceId = item.mainSource.source;
        const sourceDir = path.join(outputDir, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id);
        const preferredFileName = `hazard_1_${sourceId}_1_${baseName}.json`;
        
        if (!writtenFileNames.has(sourceId)) {
            writtenFileNames.set(sourceId, new Set<string>());
        }
        const usedNames = writtenFileNames.get(sourceId)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    // 生成 namelist
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    const namelistData = outputData.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));
    
    const output = {
        type: 'hazard',
        data: namelistData
    };
    
    const outputPath = path.join(namelistDir, 'hazardnamelist.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 hazardnamelist.json 文件：${outputPath}`);

    return { count: outputData.length };
};
