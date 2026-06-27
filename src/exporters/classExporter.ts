import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent, tagParser } from '../contentGen.js';
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

        for (const [className, fileName] of Object.entries(indexMap)) {
            const data = await readJson<Record<string, any>>(path.join(baseDir, 'class', fileName));
            for (const cls of data.class || []) {
                cls._className = className;
            }
            for (const sub of data.subclass || []) {
                sub._className = className;
            }
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
            block.entries = block.entries.map((entry: any) => {
                if (typeof entry === 'string') {
                    return tagParser.parse(entry, locale === 'zh');
                } else if (entry && typeof entry === 'object') {
                    if (entry.type === 'table' && Array.isArray(entry.rows)) {
                        entry.rows = entry.rows.map((row: any[]) => {
                            return row.map((cell: any) => {
                                if (typeof cell === 'string') {
                                    return tagParser.parse(cell, locale === 'zh');
                                }
                                return cell;
                            });
                        });
                    }
                    if (entry.entries && Array.isArray(entry.entries)) {
                        entry.entries = entry.entries.map((subEntry: any) => {
                            if (typeof subEntry === 'string') {
                                return tagParser.parse(subEntry, locale === 'zh');
                            }
                            return subEntry;
                        });
                    }
                    if (typeof entry.entry === 'string') {
                        entry.entry = tagParser.parse(entry.entry, locale === 'zh');
                    }
                    if (typeof entry.name === 'string') {
                        entry.name = tagParser.parse(entry.name, locale === 'zh');
                    }
                }
                return entry;
            });
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
        forceLocalizedKeys: ['multiclassing'],
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    delete common.source;
    delete common.page;
    delete common.classSource;
    delete common._className;
    delete enOut.source;
    delete enOut.page;
    delete enOut.classSource;
    delete enOut._className;
    delete zhOut.source;
    delete zhOut.page;
    delete zhOut.classSource;
    delete zhOut._className;

    applyEntriesHtml(enOut, id, 'en');
    applyEntriesHtml(zhOut, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);
    // 取消将英文内容添加到 zh 对象中的功能
    // appendEnglishShadowFields(zhOut, enOut);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    const result: Record<string, any> = {
        dataType: 'class',
        uid: `class_${id}`,
        id,
        ...common,
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
    delete result.source;
    delete result.page;
    delete result.classSource;
    delete result._className;
    return result;
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
    classes: Record<string, any>[];
    subclasses: Record<string, any>[];
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
            const id = `${resolved.ENG_name || resolved.name}|${resolved.source}|${resolved.classSource || ''}`;
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

    // 构建 subclassFeature 映射表
    const buildSubclassFeatureMap = (lang: 'en' | 'zh') => {
        const map = new Map<string, Record<string, any>>();
        
        const features = lang === 'en' ? classData.en.subclassFeature : classData.zh.subclassFeature;
        
        for (const feature of features) {
            const featureName = feature.name || feature.ENG_name || '';
            const className = feature.className || '';
            const classSource = feature.classSource || feature.source || '';
            const subclassShortName = feature.subclassShortName || feature.subclassName || '';
            const subclassSource = feature.subclassSource || feature.source || '';
            const level = feature.level || 0;
            
            if (!featureName || !className || !subclassShortName) continue;
            
            const keys = [];
            keys.push(`${featureName}|${className}|${classSource}|${subclassShortName}|${subclassSource}|${level}`);
            keys.push(`${featureName}|${className}|${classSource}|${subclassShortName}|${subclassSource}||${level}`);
            keys.push(`${featureName}|${className}|${classSource}|${subclassShortName}||${subclassSource}|${level}`);
            keys.push(`${featureName}|${className}||${subclassShortName}|${subclassSource}|${level}`);
            keys.push(`${featureName}|${className}|${classSource}|${subclassShortName}||${level}`);
            keys.push(`${featureName}|${className}||${subclassShortName}||${level}`);
            
            for (const key of keys) {
                if (!map.has(key)) {
                    map.set(key, feature);
                }
            }
        }
        
        return map;
    };
    
    const subclassFeatureEnMap = buildSubclassFeatureMap('en');
    const subclassFeatureZhMap = buildSubclassFeatureMap('zh');
    
    // 构建 classFeature 映射表
    const buildClassFeatureMap = () => {
        const map = new Map<string, Record<string, any>>();
        
        const allFeatures = [...classData.en.classFeature, ...classData.zh.classFeature];
        
        for (const feature of allFeatures) {
            const featureName = feature.name || feature.ENG_name || '';
            const className = feature.className || '';
            const classSource = feature.classSource || feature.source || '';
            const level = feature.level || 0;
            
            if (!featureName || !className) continue;
            
            const keys = [];
            keys.push(`${featureName}|${className}|${classSource}|${level}`);
            keys.push(`${featureName}|${className}|${classSource}||${level}`);
            keys.push(`${featureName}|${className}||${level}`);
            
            for (const key of keys) {
                if (!map.has(key)) {
                    map.set(key, feature);
                }
            }
        }
        
        return map;
    };
    
    const classFeatureMap = buildClassFeatureMap();
    
    const expandClassFeatures = (features: any[]): any[] => {
        const result: any[] = [];
        
        for (const item of features) {
            if (typeof item === 'string') {
                const feature = classFeatureMap.get(item);
                if (feature) {
                    const expanded = { ...feature };
                    // 递归处理特性的 entries 字段中的 refClassFeature
                    expandRefClassFeatureInEntries(expanded);
                    result.push(expanded);
                } else {
                    result.push(item);
                }
            } else if (item && typeof item === 'object') {
                if (item.type === 'refClassFeature' && item.classFeature) {
                    const feature = classFeatureMap.get(item.classFeature);
                    if (feature) {
                        const expanded = { ...feature };
                        // 递归处理特性的 entries 字段中的 refClassFeature
                        expandRefClassFeatureInEntries(expanded);
                        result.push(expanded);
                    } else {
                        result.push(item);
                    }
                } else if (item.classFeature && item.gainSubclassFeature === true) {
                    // 递归处理条目内的 refClassFeature
                    expandRefClassFeatureInEntries(item);
                    result.push(item);
                } else {
                    // 递归处理条目内的 refClassFeature
                    expandRefClassFeatureInEntries(item);
                    result.push(item);
                }
            } else {
                result.push(item);
            }
        }
        
        return result;
    };
    
    const expandRefClassFeatureInEntries = (item: any): void => {
        if (!item || typeof item !== 'object') return;
        
        // 如果是 options 类型，处理其 entries
        if (item.type === 'options' && Array.isArray(item.entries)) {
            item.entries = item.entries.map((entry: any) => {
                if (entry && typeof entry === 'object') {
                    if (entry.type === 'refClassFeature' && entry.classFeature) {
                        const feature = classFeatureMap.get(entry.classFeature);
                        if (feature) {
                            const expanded = { ...feature, type: 'refClassFeature' };
                            expandRefClassFeatureInEntries(expanded);
                            return expanded;
                        }
                    }
                    expandRefClassFeatureInEntries(entry);
                }
                return entry;
            });
        }
        
        // 处理 entries 字段（包括 type: "entries" 的情况）
        if (Array.isArray(item.entries)) {
            item.entries = item.entries.map((entry: any) => {
                if (entry && typeof entry === 'object') {
                    if (entry.type === 'refClassFeature' && entry.classFeature) {
                        const feature = classFeatureMap.get(entry.classFeature);
                        if (feature) {
                            const expanded = { ...feature, type: 'refClassFeature' };
                            expandRefClassFeatureInEntries(expanded);
                            return expanded;
                        }
                    }
                    expandRefClassFeatureInEntries(entry);
                }
                return entry;
            });
        }
        
        // 递归处理其他可能包含 entries 的字段
        for (const key of Object.keys(item)) {
            if (key !== 'entries' && item[key] && typeof item[key] === 'object') {
                expandRefClassFeatureInEntries(item[key]);
            }
        }
    };
    
    const processTagsInFeature = (feature: any, isZh: boolean) => {
        if (!feature || typeof feature !== 'object') return;
        
        if (Array.isArray(feature.entries)) {
            feature.entries = feature.entries.map((entry: any) => {
                if (typeof entry === 'string') {
                    return tagParser.parse(entry, isZh);
                } else if (entry && typeof entry === 'object') {
                    if (entry.type === 'table' && Array.isArray(entry.rows)) {
                        entry.rows = entry.rows.map((row: any[]) => {
                            return row.map((cell: any) => {
                                if (typeof cell === 'string') {
                                    return tagParser.parse(cell, isZh);
                                }
                                return cell;
                            });
                        });
                    }
                    if (entry.entries && Array.isArray(entry.entries)) {
                        entry.entries = entry.entries.map((subEntry: any) => {
                            if (typeof subEntry === 'string') {
                                return tagParser.parse(subEntry, isZh);
                            }
                            return subEntry;
                        });
                    }
                    if (typeof entry.entry === 'string') {
                        entry.entry = tagParser.parse(entry.entry, isZh);
                    }
                    if (typeof entry.name === 'string') {
                        entry.name = tagParser.parse(entry.name, isZh);
                    }
                }
                return entry;
            });
        }
        
        if (feature.subclassFeatures && Array.isArray(feature.subclassFeatures)) {
            feature.subclassFeatures = feature.subclassFeatures.map((sf: any) => {
                if (sf && typeof sf === 'object') {
                    processTagsInFeature(sf, isZh);
                }
                return sf;
            });
        }
        
        if (feature.classFeatures && Array.isArray(feature.classFeatures)) {
            feature.classFeatures = feature.classFeatures.map((cf: any) => {
                if (cf && typeof cf === 'object') {
                    processTagsInFeature(cf, isZh);
                }
                return cf;
            });
        }
    };
    
    const expandRefSubclassFeatures = (features: any[], isZh: boolean = false): any[] => {
        const result: any[] = [];
        const subclassFeatureMap = isZh ? subclassFeatureZhMap : subclassFeatureEnMap;
        
        for (const item of features) {
            if (typeof item === 'string') {
                const feature = subclassFeatureMap.get(item);
                if (feature) {
                    const expanded = { ...feature };
                    processTagsInFeature(expanded, isZh);
                    const extractedFeatures = extractRefFeaturesFromEntries(expanded, isZh);
                    result.push(expanded);
                    result.push(...extractedFeatures);
                } else {
                    result.push(item);
                }
            } else if (item && typeof item === 'object') {
                if (item.type === 'refSubclassFeature' && item.subclassFeature) {
                    const feature = subclassFeatureMap.get(item.subclassFeature);
                    if (feature) {
                        const expanded = { ...feature };
                        processTagsInFeature(expanded, isZh);
                        const extractedFeatures = extractRefFeaturesFromEntries(expanded, isZh);
                        result.push(expanded);
                        result.push(...extractedFeatures);
                    } else {
                        result.push(item);
                    }
                } else {
                    const newItem = { ...item };
                    processTagsInFeature(newItem, isZh);
                    const extractedFeatures = extractRefFeaturesFromEntries(newItem, isZh);
                    result.push(newItem);
                    result.push(...extractedFeatures);
                }
            } else {
                result.push(item);
            }
        }
        
        return result;
    };
    
    const extractRefFeaturesFromEntries = (feature: any, isZh: boolean = false): any[] => {
        const extracted: any[] = [];
        const subclassFeatureMap = isZh ? subclassFeatureZhMap : subclassFeatureEnMap;
        
        if (feature && feature.entries && Array.isArray(feature.entries)) {
            feature.entries = feature.entries.filter((entry: any) => {
                if (entry && typeof entry === 'object' && entry.type === 'refSubclassFeature' && entry.subclassFeature) {
                    const refFeature = subclassFeatureMap.get(entry.subclassFeature);
                    if (refFeature) {
                        const expanded = { ...refFeature };
                        processTagsInFeature(expanded, isZh);
                        const nestedExtracted = extractRefFeaturesFromEntries(expanded, isZh);
                        extracted.push(expanded);
                        extracted.push(...nestedExtracted);
                    }
                    return false;
                }
                return true;
            });
        }
        
        return extracted;
    };
    
    // 生成 class 数据
    const classOutput: Record<string, any>[] = [];
    // 构建职业名称映射表（中文 -> 英文）

    const classNameMap = new Map<string, string>();

    for (const enClass of classData.en.class) {

        const zhClass = classZhMap.get(getDefaultId(enClass));

        if (zhClass) {

            classNameMap.set(zhClass.name, enClass.name);

        }

    }

    

    for (const enClass of classData.en.class) {
        const id = getDefaultId(enClass);
        const zhClass = classZhMap.get(id);

        const classId = `${enClass.name}|${enClass.source}`;
        const isBasicRules2024 = enClass.basicRules2024 === true;

        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of classData.en.subclass) {
            sourceMap.set(getSubclassCompositeKey(entry), entry);
        }
        
        const subclassesForClass = classData.en.subclass
            .filter(item => {
                const classNameEn = classNameMap.get(item.className) || item.className;
                return `${classNameEn}|${item.classSource}` === classId;
            })
            .map(item => resolveSubclassCopy(item, sourceMap));

        const subclassMap = new Map<string, any[]>();
        for (const subclass of subclassesForClass) {
            const displayNameEn = subclass.shortName || subclass.name || '';
            if (!subclassMap.has(displayNameEn)) {
                subclassMap.set(displayNameEn, []);
            }
            subclassMap.get(displayNameEn)!.push(subclass);
        }

        const classes: string[] = [];
        for (const [, subclasses] of subclassMap) {
            if (subclasses.length > 0) {
                classes.push(getDefaultId(subclasses[0]));
            }
        }

        const classEntityBase = buildEntityBase(
            enClass,
            zhClass,
            classEnMap,
            classReprintMap,
            classFluffStore.getFull(id)
        );
        
        // 替换 classFeatures 中的 ID 为完整对象
        if (classEntityBase.zh && classEntityBase.zh.classFeatures) {
            classEntityBase.zh.classFeatures = expandClassFeatures(classEntityBase.zh.classFeatures);
        }
        if (classEntityBase.en && classEntityBase.en.classFeatures) {
            classEntityBase.en.classFeatures = expandClassFeatures(classEntityBase.en.classFeatures);
        }
        
        classOutput.push({
            ...classEntityBase,
            classes,
        });
    }

    // 生成 subclass 数据
    const subclassOutput: Record<string, any>[] = [];
    for (const enSubclass of subclassEnEntries) {
        const id = getDefaultId(enSubclass);
        const zhSubclass = subclassZhMap.get(id);

        const superiorClassName = classNameMap.get(enSubclass.className) || enSubclass.className;
        const superiorId = `${superiorClassName}|${enSubclass.classSource}`;

        const entityBase = buildEntityBase(
            enSubclass,
            zhSubclass,
            subclassEnMap,
            subclassReprintMap,
            subclassFluffStore.getFull(id)
        );
        
        // 替换 subclassFeatures 中的 ID 为完整对象
        if (entityBase.zh && entityBase.zh.subclassFeatures) {
            entityBase.zh.subclassFeatures = expandRefSubclassFeatures(entityBase.zh.subclassFeatures, true);
        }
        if (entityBase.en && entityBase.en.subclassFeatures) {
            entityBase.en.subclassFeatures = expandRefSubclassFeatures(entityBase.en.subclassFeatures, false);
        }

        subclassOutput.push({
            ...entityBase,
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
        // 特殊处理：Artificer|EFA 强制设置 basicRules2024: true
        if (item.id === 'Artificer|EFA') {
            item.basicRules2024 = true;
        }
        const className = (item.displayName.en || item.id.split('|')[0] || 'other').toLowerCase();
        const sourceId = item.mainSource.source;
        const sourceDir = path.join(classOutputDir, className, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
        const preferredFileName = `${baseName}.json`;
        
        const key = `${className}|${sourceId}`;
        if (!classWrittenFileNames.has(key)) {
            classWrittenFileNames.set(key, new Set<string>());
        }
        const usedNames = classWrittenFileNames.get(key)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    // 输出 subclass 文件
    const subclassOutputDir = path.join('./output', 'class');
    await fs.mkdir(subclassOutputDir, { recursive: true });
    const subclassWrittenFileNames = new Map<string, Set<string>>();

    for (const item of subclassOutput) {
        // 特殊处理：Artificer|EFA 的子职业强制设置 basicRules2024: true
        if (item.superiorfork?.superior === 'Artificer|EFA') {
            item.basicRules2024 = true;
        }
        
        const className = item.superiorfork?.superior?.split('|')[0]?.toLowerCase() || 'other';
        const sourceId = item.mainSource.source;
        const sourceDir = path.join(subclassOutputDir, className, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const baseName = escapeFileName(mwUtil.getMwTitle(item.displayName.en || item.displayName.zh || item.id));
        const preferredFileName = `${baseName}.json`;
        
        const key = `${className}|${sourceId}`;
        if (!subclassWrittenFileNames.has(key)) {
            subclassWrittenFileNames.set(key, new Set<string>());
        }
        const usedNames = subclassWrittenFileNames.get(key)!;
        
        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    // 生成 namelist
    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });
    
    // 构建主职业 basicRules2024 映射表（按完整职业 ID 匹配，如 "Wizard|PHB"）
    const classBasicRulesMap = new Map<string, boolean>();
    for (const item of classOutput) {
        const className = item.id.split('|')[0]; // 提取职业名称（如 "Wizard"）
        const source = item.id.split('|')[1]; // 提取来源（如 "XPHB"）
        
        // 特殊处理：EFA 来源的奇械师（Artificer）强制设置为 basicRules2024
        let basicRulesValue = item.basicRules2024 || false;
        if (className === 'Artificer' && source === 'EFA') {
            basicRulesValue = true;
        }
        
        // 按完整职业 ID 存储（如 "Wizard|PHB"）
        classBasicRulesMap.set(item.id, basicRulesValue);
    }
    
    const classNamelistData = [
        ...classOutput.map(item => {
            const className = item.id.split('|')[0];
            const source = item.id.split('|')[1];
            
            // 特殊处理：EFA 来源的奇械师（Artificer）强制设置为 basicRules2024
            let basicRules2024 = item.basicRules2024 || false;
            if (className === 'Artificer' && source === 'EFA') {
                basicRules2024 = true;
            }
            
            return {
                id: item.id || '',
                src: item.mainSource?.source || '',
                name_en: item.displayName?.en || '',
                name_zh: item.displayName?.zh || item.displayName?.en || '',
                basicRules2024,
                superior: item.superiorfork?.superior || ''
            };
        }),
        ...subclassOutput.map(item => {
            const superiorId = item.superiorfork?.superior || '';
            // 使用完整的上级职业 ID（如 "Wizard|PHB"）来查找 basicRules2024
            const parentBasicRules2024 = classBasicRulesMap.get(superiorId) || false;
            // 如果子职业自身的 basicRules2024 为 true，或者上级职业的 basicRules2024 为 true，则为 true
            const basicRules2024 = (item.basicRules2024 || false) || parentBasicRules2024;
            
            return {
                id: item.id || '',
                src: item.mainSource?.source || '',
                name_en: item.displayName?.en || '',
                name_zh: item.displayName?.zh || item.displayName?.en || '',
                basicRules2024,
                superior: superiorId
            };
        })
    ];
    
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
        name_zh: item.displayName?.zh || item.displayName?.en || '',
        basicRules2024: item.basicRules2024 || false,
        superior: item.superiorfork?.superior || ''    }));
    
    const subclassOutputNamelist = {
        type: 'subclass',
        data: subclassNamelistData
    };
    
    const subclassOutputPath = path.join(namelistDir, 'subclassnamelist.json');
    await fs.writeFile(subclassOutputPath, JSON.stringify(subclassOutputNamelist, null, 2), 'utf-8');
    console.log(`已生成 subclassnamelist.json 文件：${subclassOutputPath}`);

    return { 
    classCount: classOutput.length, 
    subclassCount: subclassOutput.length,
    classes: classOutput,
    subclasses: subclassOutput
};
};
