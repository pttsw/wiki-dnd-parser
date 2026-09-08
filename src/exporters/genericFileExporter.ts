import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent } from '../contentGen.js';
import type { ExportProfile } from './profileTypes.js';
import { buildFluffStore } from './fluff.js';
import {
    buildAllSources,
    buildReprintMap,
    collectRelatedIds,
    escapeFileName,
    extractTranslator,
    getDefaultId,
    hasLocalizedDifference,
    normalizeReprintedAs,
    resolveCaseInsensitiveOutputFileName,
    splitStructuredRecordByDiff,
} from './shared.js';
import { isHomebrewMode, HOMEBREW_FILE_MAP, mergeHomebrewBilingual, isHomebrewSource } from '../homebrewLoader.js';

type LoggerLike = {
    log: (source: string, message: string) => void;
};

type IdMgrLike = {
    compare: <T>(
        dataType: string,
        data: { en: T[]; zh: T[] },
        fn: {
            getId: (item?: T | null) => string;
            getZhTitle: (item: T) => string | null;
            getEnTitle: (item: T) => string | null;
        }
    ) => void;
};

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
    let [en, zh] = await Promise.all([
        readJson<Record<string, any>>(enPath),
        readJson<Record<string, any>>(zhPath),
    ]);

    // homebrew 模式：合并对应的 homebrew 分类数据
    const homebrewCategories = HOMEBREW_FILE_MAP[relativePath];
    if (isHomebrewMode && homebrewCategories) {
        const merged = await mergeHomebrewBilingual(en, zh, homebrewCategories);
        en = merged.en;
        zh = merged.zh;
    }

    const next = { en, zh };
    cache.set(relativePath, next);
    return next;
};

const getRootEntries = (file: Record<string, any>, rootKey: string) =>
    Array.isArray(file?.[rootKey]) ? [...file[rootKey]] : [];

const dedupeEntries = (
    entries: Record<string, any>[],
    getId: (item: Record<string, any>) => string,
    logger: LoggerLike,
    logSource: string
) => {
    const seen = new Map<string, Record<string, any>>();
    for (const entry of entries) {
        const id = getId(entry);
        if (seen.has(id)) {
            logger.log(logSource, `重复 ID，保留首条记录：${id}`);
            continue;
        }
        seen.set(id, entry);
    }
    return {
        entries: [...seen.values()],
        map: seen,
    };
};

const applyEntriesHtml = (
    block: Record<string, any>,
    logger: LoggerLike,
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
    } catch (error) {
        logger.log(
            'GenericFileExporter',
            `${dataType}:${id}:${locale} 生成 html 失败，保留原始 entries`
        );
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

const writeFileOutput = async (
    profile: ExportProfile,
    data: Record<string, any>[],
    logger: LoggerLike
) => {
    if (!profile.dataType) {
        logger.log('GenericFileExporter', `缺少 dataType，跳过文件输出: ${JSON.stringify(profile)}`);
        return;
    }
    const outputDir = path.join('./output', profile.dataType);
    await fs.mkdir(outputDir, { recursive: true });
    const writtenFileNames = new Map<string, Set<string>>();

    for (const item of data) {
        const sourceId = escapeFileName(item.mainSource?.source || '');
        if (!sourceId || sourceId === escapeFileName('')) {
            logger.log('GenericFileExporter', `缺少 source，跳过条目: ${item.id || item.displayName?.en} (${profile.dataType})`);
            continue;
        }
        const sourceDir = path.join(outputDir, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
        const preferredFileName = `${baseName}.json`;
        
        if (!writtenFileNames.has(sourceId)) {
            writtenFileNames.set(sourceId, new Set<string>());
        }
        const usedNames = writtenFileNames.get(sourceId)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(
            usedNames,
            preferredFileName,
            item.id
        );
        
        if (fileName !== preferredFileName) {
            logger.log(
                'GenericFileExporter',
                `导出文件名冲突，改用去重文件名：${preferredFileName} -> ${fileName} (${item.id})`
            );
        }
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }
};

const writeNameListOutput = async (profile: ExportProfile, data: Record<string, any>[]) => {
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    const namelistData = data.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || '',
        ishomebrew: !!item.ishomebrew
    }));
    
    const output = {
        type: profile.dataType,
        data: namelistData
    };
    
    const outputPath = path.join(namelistDir, `${profile.dataType}namelist.json`);
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 ${profile.dataType}namelist.json 文件：${outputPath}`);
};

const buildEntity = (
    profile: ExportProfile,
    enItem: Record<string, any>,
    zhItem: Record<string, any> | null | undefined,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>,
    full: { en?: any; zh?: any } | undefined,
    logger: LoggerLike
) => {
    const id = getDefaultId(enItem);
    const split = splitStructuredRecordByDiff(enItem, zhItem, {
        emptyZhValue: '',
        forceCommonKeys: profile.forceCommonKeys,
        forceLocalizedKeys: profile.forceLocalizedKeys,
        skipKeys: profile.skipKeys,
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    applyEntriesHtml(enOut, logger, profile.dataType, id, 'en');
    applyEntriesHtml(zhOut, logger, profile.dataType, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    return {
        dataType: profile.dataType,
        uid: `${profile.dataType}_${id}`,
        id,
        ishomebrew: isHomebrewSource(enItem.source),
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

const collectDiffKeys = (
    enEntries: Record<string, any>[],
    zhMap: Map<string, Record<string, any>>
): Set<string> => {
    const diffKeys = new Set<string>();
    for (const enItem of enEntries) {
        const id = getDefaultId(enItem);
        const zhItem = zhMap.get(id);
        if (!zhItem) continue;
        const keys = new Set([...Object.keys(enItem), ...Object.keys(zhItem)]);
        for (const key of keys) {
            if (diffKeys.has(key)) continue;
            if (hasLocalizedDifference(enItem[key], zhItem[key])) {
                diffKeys.add(key);
            }
        }
    }
    return diffKeys;
};

const runSingleProfile = async (
    profile: ExportProfile,
    deps: { idMgr: IdMgrLike; logger: LoggerLike },
    fileCache: Map<string, { en: Record<string, any>; zh: Record<string, any> }>
): Promise<Record<string, any>[]> => {
    const bilingual = await loadBilingualFileCached(profile.sourceFile, fileCache);
    const enRawEntries = getRootEntries(bilingual.en, profile.rootKey);
    const zhRawEntries = getRootEntries(bilingual.zh, profile.rootKey);

    const { entries: enEntries, map: enMap } = dedupeEntries(
        enRawEntries,
        getDefaultId,
        deps.logger,
        profile.dataType
    );
    const { entries: zhEntries, map: zhMap } = dedupeEntries(
        zhRawEntries,
        getDefaultId,
        deps.logger,
        profile.dataType
    );

    deps.idMgr.compare(profile.dataType, { en: enEntries, zh: zhEntries }, {
        getId: item => getDefaultId(item as Record<string, any>),
        getEnTitle: item => (item as Record<string, any>).name || null,
        getZhTitle: item => (item as Record<string, any>).name || null,
    });

    let fluffStore: ReturnType<typeof buildFluffStore> | undefined;
    if (profile.fluffFile && profile.fluffRootKey) {
        const fluffBilingual = await loadBilingualFileCached(profile.fluffFile, fileCache);
        fluffStore = buildFluffStore(
            getRootEntries(fluffBilingual.zh, profile.fluffRootKey),
            getRootEntries(fluffBilingual.en, profile.fluffRootKey)
        );
    }

    const reprintMap = buildReprintMap(enEntries, getDefaultId);

    // 预扫描：找出所有条目中存在汉化差异的键，强制该类型所有文件都拆分这些键
    const diffKeys = collectDiffKeys(enEntries, zhMap);
    const baseForceLocalized = new Set(profile.forceLocalizedKeys || []);
    const effectiveForceLocalized = [...new Set([...baseForceLocalized, ...diffKeys])];
    const effectiveProfile = effectiveForceLocalized.length > baseForceLocalized.size
        ? { ...profile, forceLocalizedKeys: effectiveForceLocalized }
        : profile;

    const outputData: Record<string, any>[] = [];

    for (const enItem of enEntries) {
        const id = getDefaultId(enItem);
        const zhItem = zhMap.get(id);
        if (!zhItem) {
            deps.logger.log(profile.dataType, `未找到中文版本条目：${enItem.name} (${id})`);
        }
        const full = fluffStore?.getFull(id);
        outputData.push(buildEntity(effectiveProfile, enItem, zhItem, enMap, reprintMap, full, deps.logger));
    }

    await writeFileOutput(profile, outputData, deps.logger);
    await writeNameListOutput(profile, outputData);

    return outputData;
};

export interface GenericFileExporterResult {
    counts: Record<string, number>;
    data: Record<string, Record<string, any>[]>;
}

export const runGenericFileExporter = async (
    profiles: ExportProfile[],
    deps: { idMgr: IdMgrLike; logger: LoggerLike }
): Promise<GenericFileExporterResult> => {
    const fileCache = new Map<string, { en: Record<string, any>; zh: Record<string, any> }>();
    const counts: Record<string, number> = {};
    const data: Record<string, Record<string, any>[]> = {};

    for (const profile of profiles) {
        const result = await runSingleProfile(profile, deps, fileCache);
        counts[profile.dataType] = result.length;
        data[profile.dataType] = result;
    }

    return { counts, data };
};