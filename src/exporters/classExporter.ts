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
        console.log(`[ClassExporter] ${id}:${locale} 生成 html 失败`);
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
    enItem: Record<string, any>,
    zhItem: Record<string, any> | null | undefined,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>,
    full: { en?: any; zh?: any } | undefined,
) => {
    const id = getDefaultId(enItem);
    const split = splitStructuredRecordByDiff(enItem, zhItem, {
        emptyZhValue: '',
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    applyEntriesHtml(enOut, id, 'en');
    applyEntriesHtml(zhOut, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);
    appendEnglishShadowFields(zhOut, enOut);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    return {
        dataType: 'class',
        uid: `class_${id}`,
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

export interface ClassExporterResult {
    classCount: number;
    subclassCount: number;
}

export const runClassExporter = async (): Promise<ClassExporterResult> => {
    const [classData, fluffData] = await Promise.all([
        loadIndexedClassData(),
        loadIndexedClassFluffData(),
    ]);

    const classFluffStore = buildFluffStore(fluffData.zh.classFluff, fluffData.en.classFluff);
    const subclassFluffStore = buildFluffStore(fluffData.zh.subclassFluff, fluffData.en.subclassFluff);

    const classEnMap = new Map(classData.en.class.map(item => [getDefaultId(item), item]));
    const classZhMap = new Map(classData.zh.class.map(item => [getDefaultId(item), item]));
    const classReprintMap = buildReprintMap(classData.en.class, getDefaultId);

    const { entries: subclassEnEntries, map: subclassEnMap } = (() => {
        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of classData.en.subclass) {
            sourceMap.set(getSubclassCompositeKey(entry), entry);
        }

        const byId = new Map<string, Record<string, any>>();
        for (const entry of classData.en.subclass) {
            const resolved = resolveSubclassCopy(entry, sourceMap);
            const id = getDefaultId(resolved);
            const previous = byId.get(id);
            if (!previous) {
                byId.set(id, resolved);
                continue;
            }
            if (previous._copy && !entry._copy) {
                byId.set(id, resolved);
            }
        }

        return {
            entries: [...byId.values()],
            map: byId,
        };
    })();

    const { entries: subclassZhEntries, map: subclassZhMap } = (() => {
        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of classData.zh.subclass) {
            sourceMap.set(getSubclassCompositeKey(entry), entry);
        }

        const byId = new Map<string, Record<string, any>>();
        for (const entry of classData.zh.subclass) {
            const resolved = resolveSubclassCopy(entry, sourceMap);
            const id = getDefaultId(resolved);
            const previous = byId.get(id);
            if (!previous) {
                byId.set(id, resolved);
                continue;
            }
            if (previous._copy && !entry._copy) {
                byId.set(id, resolved);
            }
        }

        return {
            entries: [...byId.values()],
            map: byId,
        };
    })();

    const subclassReprintMap = buildReprintMap(subclassEnEntries, getDefaultId);

    // 生成 class 数据
    const classOutput: Record<string, any>[] = [];
    for (const enClass of classData.en.class) {
        const id = getDefaultId(enClass);
        const zhClass = classZhMap.get(id);

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
                enClass,
                zhClass,
                classEnMap,
                classReprintMap,
                classFluffStore.getFull(id)
            ),
            subclasses,
        });
    }

    // 生成 subclass 数据
    const subclassOutput: Record<string, any>[] = [];
    for (const enSubclass of subclassEnEntries) {
        const id = getDefaultId(enSubclass);
        const zhSubclass = subclassZhMap.get(id);

        const superiorId = `${enSubclass.className}|${enSubclass.classSource}`;

        subclassOutput.push({
            ...buildEntityBase(
                enSubclass,
                zhSubclass,
                subclassEnMap,
                subclassReprintMap,
                subclassFluffStore.getFull(id)
            ),
            superiorfork: buildSuperiorfork({
                superior: superiorId,
                fork: 1,
            }),
        });
    }

    // 输出 class 文件
    const classOutputDir = path.join('./output', 'class');
    await fs.mkdir(classOutputDir, { recursive: true });
    const classWrittenFileNames = new Map<string, Set<string>>();

    for (const item of classOutput) {
        const sourceId = item.mainSource.source;
        const sourceDir = path.join(classOutputDir, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
        const preferredFileName = `${baseName}.json`;
        
        if (!classWrittenFileNames.has(sourceId)) {
            classWrittenFileNames.set(sourceId, new Set<string>());
        }
        const usedNames = classWrittenFileNames.get(sourceId)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    // 输出 subclass 文件
    const subclassOutputDir = path.join('./output', 'subclass');
    await fs.mkdir(subclassOutputDir, { recursive: true });
    const subclassWrittenFileNames = new Map<string, Set<string>>();

    for (const item of subclassOutput) {
        const sourceId = item.mainSource.source;
        const sourceDir = path.join(subclassOutputDir, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
        const preferredFileName = `${baseName}.json`;
        
        if (!subclassWrittenFileNames.has(sourceId)) {
            subclassWrittenFileNames.set(sourceId, new Set<string>());
        }
        const usedNames = subclassWrittenFileNames.get(sourceId)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    // 生成 namelist
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    const classNamelistData = classOutput.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));
    
    const classOutputNamelist = {
        type: 'class',
        data: classNamelistData
    };
    
    const classOutputPath = path.join(namelistDir, 'classnamelist.json');
    await fs.writeFile(classOutputPath, JSON.stringify(classOutputNamelist, null, 2), 'utf-8');
    console.log(`已生成 classnamelist.json 文件：${classOutputPath}`);

    const subclassNamelistData = subclassOutput.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));
    
    const subclassOutputNamelist = {
        type: 'subclass',
        data: subclassNamelistData
    };
    
    const subclassOutputPath = path.join(namelistDir, 'subclassnamelist.json');
    await fs.writeFile(subclassOutputPath, JSON.stringify(subclassOutputNamelist, null, 2), 'utf-8');
    console.log(`已生成 subclassnamelist.json 文件：${subclassOutputPath}`);

    return { classCount: classOutput.length, subclassCount: subclassOutput.length };
};
