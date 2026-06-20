import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent } from '../contentGen.js';
import type { ExportProfile } from './profileTypes.js';
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

type GenericExporterDeps = {
    idMgr: IdMgrLike;
    logger: LoggerLike;
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
    const [en, zh] = await Promise.all([
        readJson<Record<string, any>>(enPath),
        readJson<Record<string, any>>(zhPath),
    ]);
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
            'GenericProfileExporter',
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
    const outputDir = path.join('./output', profile.dataType);
    await fs.mkdir(outputDir, { recursive: true });
    const writtenFileNames = new Map<string, Set<string>>();

    for (const item of data) {
        const sourceId = item.mainSource.source;
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
                'GenericProfileExporter',
                `导出文件名冲突，改用去重文件名：${preferredFileName} -> ${fileName} (${item.id})`
            );
        }
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }
};

const writeCollectionOutput = async (profile: ExportProfile, data: Record<string, any>[]) => {
    const outputPath = path.join('./output', 'collection', `${profile.dataType}Collection.json`);
    await fs.writeFile(
        outputPath,
        JSON.stringify(
            {
                type: `${profile.dataType}Collection`,
                data,
            },
            null,
            2
        ),
        'utf-8'
    );
};

const writeNameListOutput = async (profile: ExportProfile, data: Record<string, any>[]) => {
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    const namelistData = data.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
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
    // 取消将英文内容添加到 zh 对象中的功能
    // appendEnglishShadowFields(zhOut, enOut);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    return {
        dataType: profile.dataType,
        uid: `${profile.dataType}_${id}`,
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

const runSingleProfile = async (
    profile: ExportProfile,
    deps: GenericExporterDeps,
    fileCache: Map<string, { en: Record<string, any>; zh: Record<string, any> }>
) => {
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

    let fluffStore:
        | ReturnType<typeof buildFluffStore>
        | undefined;

    if (profile.fluffFile && profile.fluffRootKey) {
        const fluffBilingual = await loadBilingualFileCached(profile.fluffFile, fileCache);
        fluffStore = buildFluffStore(
            getRootEntries(fluffBilingual.zh, profile.fluffRootKey),
            getRootEntries(fluffBilingual.en, profile.fluffRootKey)
        );
    }

    const reprintMap = buildReprintMap(enEntries, getDefaultId);
    const outputData: Record<string, any>[] = [];

    for (const enItem of enEntries) {
        const id = getDefaultId(enItem);
        const zhItem = zhMap.get(id);
        if (!zhItem) {
            deps.logger.log(profile.dataType, `未找到中文版本条目：${enItem.name} (${id})`);
        }
        const full = fluffStore?.getFull(id);
        outputData.push(buildEntity(profile, enItem, zhItem, enMap, reprintMap, full, deps.logger));
    }

    if (profile.outputMode === 'file') {
        await writeFileOutput(profile, outputData, deps.logger);
        await writeNameListOutput(profile, outputData);
        console.log(`[prepareData] ${profile.dataType} 完成 (${outputData.length})`);
    } else {
        await writeCollectionOutput(profile, outputData);
    }

    return outputData.length;
};

export const runGenericProfiles = async (
    profiles: ExportProfile[],
    deps: GenericExporterDeps
) => {
    const fileCache = new Map<string, { en: Record<string, any>; zh: Record<string, any> }>();
    const counts: Record<string, number> = {};

    for (const profile of profiles) {
        counts[profile.dataType] = await runSingleProfile(profile, deps, fileCache);
    }

    return counts;
};
