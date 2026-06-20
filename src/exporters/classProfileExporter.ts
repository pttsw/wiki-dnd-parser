import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent } from '../contentGen.js';
import { buildFluffStore } from './fluff.js';
import {
    appendEnglishShadowFields,
    buildAllSources,
    buildReprintMap,
    buildSuperiorfork,
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

type ExporterDeps = {
    idMgr: IdMgrLike;
    logger: LoggerLike;
};

const readJson = async <T>(filePath: string): Promise<T> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
};

const loadIndexedClassData = async () => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'class/index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'class/index.json')),
    ]);

    const loadSet = async (baseDir: string, indexMap: Record<string, string>) => {
        const out = {
            class: [] as Record<string, any>[],
            subclass: [] as Record<string, any>[],
            classFeature: [] as Record<string, any>[],
            subclassFeature: [] as Record<string, any>[],
        };

        for (const fileName of Object.values(indexMap)) {
            const data = await readJson<Record<string, any>>(path.join(baseDir, 'class', fileName));
            out.class.push(...(data.class || []));
            out.subclass.push(...(data.subclass || []));
            out.classFeature.push(...(data.classFeature || []));
            out.subclassFeature.push(...(data.subclassFeature || []));
        }

        return out;
    };

    const [en, zh] = await Promise.all([
        loadSet(config.DATA_EN_DIR, enIndex),
        loadSet(config.DATA_ZH_DIR, zhIndex),
    ]);

    return { en, zh };
};

const loadIndexedClassFluffData = async () => {
    const [enIndex, zhIndex] = await Promise.all([
        readJson<Record<string, string>>(path.join(config.DATA_EN_DIR, 'class/fluff-index.json')),
        readJson<Record<string, string>>(path.join(config.DATA_ZH_DIR, 'class/fluff-index.json')),
    ]);

    const loadSet = async (baseDir: string, indexMap: Record<string, string>) => {
        const out = {
            classFluff: [] as Record<string, any>[],
            subclassFluff: [] as Record<string, any>[],
        };

        for (const fileName of Object.values(indexMap)) {
            const data = await readJson<Record<string, any>>(path.join(baseDir, 'class', fileName));
            out.classFluff.push(...(data.classFluff || []));
            out.subclassFluff.push(...(data.subclassFluff || []));
        }

        return out;
    };

    const [en, zh] = await Promise.all([
        loadSet(config.DATA_EN_DIR, enIndex),
        loadSet(config.DATA_ZH_DIR, zhIndex),
    ]);

    return { en, zh };
};

const applyEntriesHtml = (
    block: Record<string, any>,
    logger: LoggerLike,
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
        logger.log('ClassProfileExporter', `${id}:${locale} 生成 html 失败，保留原始 entries`);
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

const buildEntityBase = (
    dataType: 'class' | 'subclass',
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
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    applyEntriesHtml(enOut, logger, id, 'en');
    applyEntriesHtml(zhOut, logger, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);
    // 取消将英文内容添加到 zh 对象中的功能
    // appendEnglishShadowFields(zhOut, enOut);

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

const getSubclassCompositeKey = (item: Record<string, any>) =>
    `${item.name}|${item.source}|${item.className || ''}|${item.classSource || ''}`;

const resolveSubclassCopy = (
    item: Record<string, any>,
    sourceMap: Map<string, Record<string, any>>,
    visited = new Set<string>()
): Record<string, any> => {
    if (!item._copy?.name) return item;
    const copyKey = `${item._copy.name}|${item._copy.source}|${item._copy.className || ''}|${item._copy.classSource || ''}`;
    if (visited.has(copyKey)) return item;
    const base = sourceMap.get(copyKey);
    if (!base) return item;
    visited.add(copyKey);
    const resolvedBase = resolveSubclassCopy(base, sourceMap, visited);
    const merged = {
        ...resolvedBase,
        ...item,
    };
    delete merged._copy;
    return merged;
};

const dedupeById = (
    entries: Record<string, any>[],
    logger: LoggerLike,
    logSource: string
) => {
    const sourceMap = new Map<string, Record<string, any>>();
    for (const entry of entries) {
        sourceMap.set(getSubclassCompositeKey(entry), entry);
    }

    const byId = new Map<string, Record<string, any>>();
    for (const entry of entries) {
        const resolved = resolveSubclassCopy(entry, sourceMap);
        const id = getDefaultId(resolved);
        const previous = byId.get(id);
        if (!previous) {
            byId.set(id, resolved);
            continue;
        }
        if (previous._copy && !entry._copy) {
            byId.set(id, resolved);
            continue;
        }
        logger.log(logSource, `重复 subclass ID，保留首条记录：${id}`);
    }

    return {
        entries: [...byId.values()],
        map: byId,
    };
};

const writeFileOutput = async (
    dataType: 'class' | 'subclass',
    data: Record<string, any>[],
    logger: LoggerLike
) => {
    const outputDir = path.join('./output', dataType);
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
                'ClassProfileExporter',
                `导出文件名冲突，改用去重文件名：${preferredFileName} -> ${fileName} (${item.id})`
            );
        }
        await fs.writeFile(path.join(sourceDir, fileName), JSON.stringify(item, null, 2), 'utf-8');
    }

    await writeNameListOutput(dataType, data);
};

const writeNameListOutput = async (
    dataType: 'class' | 'subclass',
    data: Record<string, any>[]
) => {
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    const namelistData = data.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));
    
    const output = {
        type: dataType,
        data: namelistData
    };
    
    const outputPath = path.join(namelistDir, `${dataType}namelist.json`);
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 ${dataType}namelist.json 文件：${outputPath}`);
};

export const runClassProfileExporters = async (deps: ExporterDeps) => {
    const [classData, fluffData] = await Promise.all([
        loadIndexedClassData(),
        loadIndexedClassFluffData(),
    ]);

    const classFluffStore = buildFluffStore(fluffData.zh.classFluff, fluffData.en.classFluff);
    const subclassFluffStore = buildFluffStore(fluffData.zh.subclassFluff, fluffData.en.subclassFluff);

    const classEnMap = new Map(classData.en.class.map(item => [getDefaultId(item), item]));
    const classZhMap = new Map(classData.zh.class.map(item => [getDefaultId(item), item]));
    const classReprintMap = buildReprintMap(classData.en.class, getDefaultId);

    deps.idMgr.compare('class', { en: classData.en.class, zh: classData.zh.class }, {
        getId: item => getDefaultId(item as Record<string, any>),
        getEnTitle: item => (item as Record<string, any>).name || null,
        getZhTitle: item => (item as Record<string, any>).name || null,
    });

    const { entries: subclassEnEntries, map: subclassEnMap } = dedupeById(
        classData.en.subclass,
        deps.logger,
        'subclass'
    );
    const { entries: subclassZhEntries, map: subclassZhMap } = dedupeById(
        classData.zh.subclass,
        deps.logger,
        'subclass'
    );
    const subclassReprintMap = buildReprintMap(subclassEnEntries, getDefaultId);

    deps.idMgr.compare('subclass', { en: subclassEnEntries, zh: subclassZhEntries }, {
        getId: item => getDefaultId(item as Record<string, any>),
        getEnTitle: item => (item as Record<string, any>).name || null,
        getZhTitle: item => (item as Record<string, any>).name || null,
    });

    const classOutput: Record<string, any>[] = [];
    for (const enClass of classData.en.class) {
        const id = getDefaultId(enClass);
        const zhClass = classZhMap.get(id);
        if (!zhClass) {
            deps.logger.log('class', `未找到中文版本职业：${enClass.name} (${id})`);
        }

        const subclasses = subclassEnEntries
            .filter(
                item => item.className === enClass.name && item.classSource === enClass.source
            )
            .map(item => ({
                id: getDefaultId(item),
                name: item.name,
                shortName: item.shortName || item.name,
                source: item.source,
                classSource: item.classSource,
            }));

        classOutput.push({
            ...buildEntityBase(
                'class',
                enClass,
                zhClass,
                classEnMap,
                classReprintMap,
                classFluffStore.getFull(id),
                deps.logger
            ),
            subclasses,
        });
    }

    const subclassOutput: Record<string, any>[] = [];
    for (const enSubclass of subclassEnEntries) {
        const id = getDefaultId(enSubclass);
        const zhSubclass = subclassZhMap.get(id);
        if (!zhSubclass) {
            deps.logger.log('subclass', `未找到中文版本子职业：${enSubclass.name} (${id})`);
        }

        const superiorId = `${enSubclass.className}|${enSubclass.classSource}`;

        subclassOutput.push({
            ...buildEntityBase(
                'subclass',
                enSubclass,
                zhSubclass,
                subclassEnMap,
                subclassReprintMap,
                subclassFluffStore.getFull(id),
                deps.logger
            ),
            superiorfork: buildSuperiorfork({
                superior: superiorId,
                fork: 1,
            }),
        });
    }

    await writeFileOutput('class', classOutput, deps.logger);
    console.log(`[prepareData] class 完成 (${classOutput.length})`);
    
    await writeFileOutput('subclass', subclassOutput, deps.logger);
    console.log(`[prepareData] subclass 完成 (${subclassOutput.length})`);

    return {
        class: classOutput.length,
        subclass: subclassOutput.length,
    };
};
