import { promises as fs } from 'fs';
import path from 'path';
import config, { mwUtil } from '../config.js';
import { parseContent, tagParser } from '../contentGen.js';
import { buildFluffStore } from './fluff.js';
import { buildFoundryStore } from './foundry.js';
import {
    appendEnglishShadowFields,
    buildAllSources,
    buildReprintMap,
    buildSuperiorfork,
    collectRelatedIds,
    escapeFileName,
    extractTranslator,
    getDefaultId,
    loadSubraceReplacementDictionary,
    normalizeReprintedAs,
    resolveCaseInsensitiveOutputFileName,
    splitStructuredRecordByDiff,
    SubraceReplacement,
} from './shared.js';
import { isHomebrewMode, loadHomebrewByKeys, mergeHomebrewData } from '../homebrewLoader.js';

const replaceRaceLinks = (text: string, replacementMap: Map<string, SubraceReplacement>): string => {
    return text.replace(/\{@race\s+([^}\s]+)/g, (match, raceName) => {
        const parts = raceName.split('|');
        if (parts.length === 2) {
            const key = raceName;
            const replacement = replacementMap.get(key);
            if (replacement) {
                return `{@race ${replacement.fullENGName}`;
            }
        }
        return match;
    });
};

const replaceSubraceNames = (entry: Record<string, any>, source: string, replacementMap: Map<string, SubraceReplacement>): Record<string, any> => {
    if (!entry || typeof entry !== 'object') return entry;
    
    let key = `${entry.name}|${source}`;
    let replacement = replacementMap.get(key);
    
    if (!replacement && entry.ENG_name) {
        key = `${entry.ENG_name}|${source}`;
        replacement = replacementMap.get(key);
    }
    
    if (replacement) {
        entry = { ...entry };
        if ('ENG_name' in entry) {
            entry.name = replacement.fullName;
            entry.ENG_name = replacement.fullENGName;
        } else {
            entry.name = replacement.fullENGName;
        }
        entry._isStandalonePage = replacement.isStandalonePage;
    }
    
    if (Array.isArray(entry.entries)) {
        entry = { ...entry };
        entry.entries = entry.entries.map((e: any) => replaceSubraceNames(e, source, replacementMap));
    }
    
    if (typeof entry.text === 'string') {
        entry = { ...entry };
        entry.text = replaceRaceLinks(entry.text, replacementMap);
    }
    
    return entry;
};

const readJson = async <T>(filePath: string): Promise<T> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
};

const loadRaceData = async () => {
    let [en, zh] = await Promise.all([
        readJson<Record<string, any>>(path.join(config.DATA_EN_DIR, 'races.json')),
        readJson<Record<string, any>>(path.join(config.DATA_ZH_DIR, 'races.json')),
    ]);

    // homebrew 模式：合并 homebrew subrace 数据
    if (isHomebrewMode) {
        const [enHb, zhHb] = await Promise.all([
            loadHomebrewByKeys('en', ['subrace', 'race']),
            loadHomebrewByKeys('zh', ['subrace', 'race']),
        ]);
        if (Object.keys(enHb).length > 0) en = mergeHomebrewData(en, enHb);
        if (Object.keys(zhHb).length > 0) zh = mergeHomebrewData(zh, zhHb);
    }
    return {
        en: {
            race: en.race || [],
            subrace: en.subrace || [],
        },
        zh: {
            race: zh.race || [],
            subrace: zh.subrace || [],
        },
    };
};

const loadRaceFluffData = async () => {
    const [en, zh] = await Promise.all([
        readJson<Record<string, any>>(path.join(config.DATA_EN_DIR, 'fluff-races.json')),
        readJson<Record<string, any>>(path.join(config.DATA_ZH_DIR, 'fluff-races.json')),
    ]);
    return {
        en: {
            raceFluff: en.raceFluff || [],
            subraceFluff: en.subraceFluff || [],
        },
        zh: {
            raceFluff: zh.raceFluff || [],
            subraceFluff: zh.subraceFluff || [],
        },
    };
};

const loadRaceFoundryData = async () => {
    const [en, zh] = await Promise.all([
        readJson<Record<string, any>>(path.join(config.DATA_EN_DIR, 'foundry-races.json')),
        readJson<Record<string, any>>(path.join(config.DATA_ZH_DIR, 'foundry-races.json')),
    ]);
    return {
        en: {
            race: en.race || [],
        },
        zh: {
            race: zh.race || [],
        },
    };
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
        console.log(`[RaceExporter] ${id}:${locale} 生成 html 失败`);
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

const getReplacedDisplayName = (
    enItem: Record<string, any>,
    zhItem: Record<string, any> | undefined,
    replacementMap: Map<string, SubraceReplacement>
) => {
    const source = enItem.source;
    let enName = enItem.name;
    let zhName = zhItem?.name;
    
    const key = `${enItem.name}|${source}`;
    const replacement = replacementMap.get(key);
    
    if (replacement) {
        enName = replacement.fullENGName;
        if (zhName) {
            zhName = replacement.fullName;
        }
    }
    
    return {
        zh: zhName && zhName.trim() !== enName.trim() ? zhName : null,
        en: enName,
    };
};

const ensureAbilityChooseAmount = (data: Record<string, any>) => {
    const processAbility = (ability: any[]) => {
        for (const entry of ability) {
            if (entry?.choose && typeof entry.choose === 'object' && !('amount' in entry.choose)) {
                entry.choose.amount = 1;
            }
        }
    };
    if (Array.isArray(data.ability)) processAbility(data.ability);
    if (data.en?.ability && Array.isArray(data.en.ability)) processAbility(data.en.ability);
    if (data.zh?.ability && Array.isArray(data.zh.ability)) processAbility(data.zh.ability);
};

const buildEntityBase = (
    enItem: Record<string, any>,
    zhItem: Record<string, any> | null | undefined,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>,
    full: { en?: any; zh?: any } | undefined,
    dataType: string,
    originalId?: string
) => {
    const id = originalId || getDefaultId(enItem);
    const split = splitStructuredRecordByDiff(enItem, zhItem, {
        emptyZhValue: '',
    });
    const common = { ...split.common };
    const enOut = { ...split.en };
    const zhOut = { ...split.zh };

    delete common.source;
    delete common.page;
    delete common.raceName;
    delete common.raceSource;
    delete enOut.source;
    delete enOut.page;
    delete enOut.raceName;
    delete enOut.raceSource;
    delete zhOut.source;
    delete zhOut.page;
    delete zhOut.raceName;
    delete zhOut.raceSource;

    applyEntriesHtml(enOut, id, 'en');
    applyEntriesHtml(zhOut, id, 'zh');

    const translator = extractTranslator(common, enOut, zhOut, zhItem, enItem);

    const relatedVersions = new Set<string>();
    normalizeReprintedAs(enItem.reprintedAs).forEach(target => relatedVersions.add(target));
    reprintMap.get(id)?.forEach(sourceId => relatedVersions.add(sourceId));

    const topLevelFields = ['traitTags', 'vulnerable', 'immune', 'resist', 'creatureTypes', 'age'];
    const topLevelExtracted: Record<string, any> = {};
    for (const field of topLevelFields) {
        if (enItem[field] !== undefined) {
            topLevelExtracted[field] = enItem[field];
        }
        delete common[field];
        delete enOut[field];
        delete zhOut[field];
    }

    const result: Record<string, any> = {
        dataType,
        uid: `${dataType}_${id}`,
        id,
        basicRules2024: !!(enItem.basicRules2024 || enItem.edition === 'one' || (typeof enItem.source === 'string' && enItem.source.startsWith('X'))),
        ...common,
        ...topLevelExtracted,
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
    delete result.raceName;
    delete result.raceSource;
    ensureAbilityChooseAmount(result);
    return result;
};

const getSubraceCompositeKey = (item: Record<string, any>) =>
    `${item.name}|${item.source}|${item.raceName || ''}|${item.raceSource || ''}`;

const resolveSubraceCopy = (
    item: Record<string, any>,
    sourceMap: Map<string, Record<string, any>>,
    visited = new Set<string>()
): Record<string, any> => {
    if (!item._copy?.name) return item;
    const copyKey = `${item._copy.name}|${item._copy.source}|${item._copy.raceName || ''}|${item._copy.raceSource || ''}`;
    if (visited.has(copyKey)) return item;
    const base = sourceMap.get(copyKey);
    if (!base) return item;
    visited.add(copyKey);
    const resolvedBase = resolveSubraceCopy(base, sourceMap, visited);
    const merged = {
        ...resolvedBase,
        ...item,
    };
    delete merged._copy;
    return merged;
};

const expandVersions = (item: Record<string, any>): Record<string, any>[] => {
    if (!item._versions || !Array.isArray(item._versions)) {
        return [item];
    }

    const results: Record<string, any>[] = [];

    for (const version of item._versions) {
        const versionItem = { ...item };
        delete versionItem._versions;

        if (version._abstract) {
            const abstractMod = version._abstract._mod;
            if (abstractMod && version._implementations) {
                for (let implIdx = 0; implIdx < version._implementations.length; implIdx++) {
                    const impl = version._implementations[implIdx];
                    const implItem = { ...versionItem };

                    if (abstractMod.entries && Array.isArray(abstractMod.entries)) {
                        const entries = [...(implItem.entries || [])];

                        for (const modEntry of abstractMod.entries) {
                            if (modEntry.mode === 'removeArr' && modEntry.names) {
                                const namesToRemove = typeof modEntry.names === 'string' ? [modEntry.names] : modEntry.names;
                                implItem.entries = entries.filter(e => 
                                    !(typeof e === 'object' && e.name && namesToRemove.includes(e.name))
                                );
                            } else if (modEntry.mode === 'replaceArr' && modEntry.replace && modEntry.items) {
                                let replaced = false;
                                implItem.entries = entries.map(e => {
                                    if (!replaced && typeof e === 'object' && e.name === modEntry.replace) {
                                        replaced = true;
                                        const replacedItems = { ...modEntry.items };
                                        
                                        if (replacedItems.entries && Array.isArray(replacedItems.entries)) {
                                            replacedItems.entries = replacedItems.entries.map((entry: string) => {
                                                if (typeof entry === 'string') {
                                                    let result = entry;
                                                    for (const [key, value] of Object.entries(impl._variables || {})) {
                                                        result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
                                                    }
                                                    return result;
                                                }
                                                return entry;
                                            });
                                        }
                                        return replacedItems;
                                    }
                                    return e;
                                });
                            } else if (modEntry.mode === 'appendArr' && modEntry.items) {
                                implItem.entries = [...entries, ...modEntry.items];
                            }
                        }
                    }

                    if (impl.resist) {
                        implItem.resist = impl.resist;
                    }

                    if (version._abstract.name) {
                        let name = version._abstract.name;
                        for (const [key, value] of Object.entries(impl._variables || {})) {
                            name = name.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
                        }
                        implItem.name = name;
                    }

                    implItem._versionImplIdx = implIdx;
                    implItem._originalName = versionItem.name || '';
                    implItem._isModExpansion = true;

                    results.push(implItem);
                }
            }
        } else {
            results.push({ ...versionItem, ...version });
        }
    }

    return results;
};

export interface RaceExporterResult {
    count: number;
    raceCount: number;
    subraceCount: number;
    subraceModCount: number;
    data: Record<string, any>[];
}

export const runRaceExporter = async (): Promise<RaceExporterResult> => {
    const [raceData, fluffData, foundryData] = await Promise.all([
        loadRaceData(),
        loadRaceFluffData(),
        loadRaceFoundryData(),
    ]);

    const raceFluffStore = buildFluffStore(fluffData.zh.raceFluff, fluffData.en.raceFluff);
    const subraceFluffStore = buildFluffStore(fluffData.zh.subraceFluff, fluffData.en.subraceFluff);
    const raceFoundryStore = buildFoundryStore(foundryData.zh.race, foundryData.en.race);

    const raceEnMap = new Map<string, Record<string, any>>(raceData.en.race.map((item: Record<string, any>) => [getDefaultId(item), item]));
    const raceZhMap = new Map<string, Record<string, any>>(raceData.zh.race.map((item: Record<string, any>) => [getDefaultId(item), item]));
    const raceReprintMap = buildReprintMap(raceData.en.race, getDefaultId);

    const subraceReplacementMap = loadSubraceReplacementDictionary();

    const { entries: subraceEnEntries, map: subraceEnMap } = (() => {
        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of raceData.en.subrace) {
            sourceMap.set(getSubraceCompositeKey(entry), entry);
        }

        const byId = new Map<string, Record<string, any>>();
        for (const entry of raceData.en.subrace) {
            const resolved = resolveSubraceCopy(entry, sourceMap);
            
            const expanded = expandVersions(resolved);
            for (const item of expanded) {
                const replacedItem = replaceSubraceNames({ ...item }, item.source, subraceReplacementMap);
                const baseId = getDefaultId(replacedItem);
                const id = item._isModExpansion ? `${baseId}#${item._versionImplIdx}` : baseId;
                const previous = byId.get(id);
                if (!previous) {
                    byId.set(id, replacedItem);
                    continue;
                }
                if (previous._copy && !item._copy) {
                    byId.set(id, replacedItem);
                }
            }
        }

        return {
            entries: [...byId.values()],
            map: byId,
        };
    })();

    const { entries: subraceZhEntries, map: subraceZhMap } = (() => {
        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of raceData.zh.subrace) {
            sourceMap.set(getSubraceCompositeKey(entry), entry);
        }

        const byId = new Map<string, Record<string, any>>();
        for (const entry of raceData.zh.subrace) {
            const resolved = resolveSubraceCopy(entry, sourceMap);
            
            const expanded = expandVersions(resolved);
            for (const item of expanded) {
                const replacedItem = replaceSubraceNames({ ...item }, item.source, subraceReplacementMap);
                const baseId = getDefaultId(replacedItem);
                const id = item._isModExpansion ? `${baseId}#${item._versionImplIdx}` : baseId;
                const previous = byId.get(id);
                if (!previous) {
                    byId.set(id, replacedItem);
                    continue;
                }
                if (previous._copy && !item._copy) {
                    byId.set(id, replacedItem);
                }
            }
        }

        return {
            entries: [...byId.values()],
            map: byId,
        };
    })();

    const subraceReprintMap = buildReprintMap(subraceEnEntries, getDefaultId);

    const classNameMap = new Map<string, string>();
    for (const enRace of raceData.en.race) {
        const zhRace = raceZhMap.get(getDefaultId(enRace)) as Record<string, any> | undefined;
        if (zhRace && typeof zhRace.name === 'string') {
            classNameMap.set(zhRace.name, enRace.name);
        }
    }

    // 对 mod 展开条目，用 EN 展开后的英文名更新 CN 条目的 ENG_name
    // 匹配键：source + 原始基础名 + implIdx
    const enModMap = new Map<string, Record<string, any>>();
    const zhModMap = new Map<string, Record<string, any>>();
    for (const enEntry of subraceEnEntries) {
        if (enEntry._isModExpansion) {
            const key = `${enEntry.source}|${enEntry._originalName || ''}|${enEntry._versionImplIdx}`;
            enModMap.set(key, enEntry);
        }
    }
    for (const zhEntry of subraceZhEntries) {
        if (zhEntry._isModExpansion) {
            const key = `${zhEntry.source}|${zhEntry.ENG_name || ''}|${zhEntry._versionImplIdx}`;
            zhModMap.set(key, zhEntry);
            const enEntry = enModMap.get(key);
            if (enEntry) {
                zhEntry.ENG_name = enEntry.name;
            }
        }
    }

    const raceOutput: Record<string, any>[] = [];
    const raceCoreMap = new Map<string, Record<string, any>>();

    for (const enRace of raceData.en.race) {
        const id = getDefaultId(enRace);
        const zhRace = raceZhMap.get(id);

        const raceId = `${enRace.name}|${enRace.source}`;

        const sourceMap = new Map<string, Record<string, any>>();
        for (const entry of raceData.en.subrace) {
            sourceMap.set(getSubraceCompositeKey(entry), entry);
        }

        const subracesForRace = subraceEnEntries
            .filter(item => {
                const raceNameEn = classNameMap.get(item.raceName) || item.raceName;
                return `${raceNameEn}|${item.raceSource}` === raceId && !item._isModExpansion && item._isStandalonePage !== false;
            });

        const subraceMap = new Map<string, any[]>();
        for (const subrace of subracesForRace) {
            const displayNameEn = subrace.shortName || subrace.name || '';
            if (!subraceMap.has(displayNameEn)) {
                subraceMap.set(displayNameEn, []);
            }
            subraceMap.get(displayNameEn)!.push(subrace);
        }

        const races: string[] = [];
        for (const [, subraceList] of subraceMap) {
            if (subraceList.length > 0) {
                races.push(getDefaultId(subraceList[0]));
            }
        }

        const raceEntityBase = buildEntityBase(
            enRace,
            zhRace as Record<string, any> | undefined,
            raceEnMap,
            raceReprintMap,
            raceFluffStore.getFull(id),
            'race',
            id
        );

        if (!raceEntityBase.creatureTypes) {
            raceEntityBase.creatureTypes = ['humanoid'];
        }

        const raceCore: Record<string, any> = {};
        if (enRace.size) raceCore.size = enRace.size;
        if (enRace.speed) raceCore.speed = enRace.speed;
        if (enRace.ability) raceCore.ability = enRace.ability;
        if (enRace.lineage) raceCore.lineage = enRace.lineage;
        if (enRace.creatureTypes) raceCore.creatureTypes = enRace.creatureTypes;
        if (enRace.skillProficiencies) raceCore.skillProficiencies = enRace.skillProficiencies;
        if (enRace.languageProficiencies) raceCore.languageProficiencies = enRace.languageProficiencies;
        if (enRace.additionalSpells) raceCore.additionalSpells = enRace.additionalSpells;
        if (enRace.age) raceCore.age = enRace.age;
        raceCoreMap.set(raceId, raceCore);

        raceOutput.push({
            ...raceEntityBase,
            races,
            foundry: raceFoundryStore.getFull(id),
        });
    }

    const subraceOutput: Record<string, any>[] = [];
    const subraceModOutput: Record<string, any>[] = [];
    for (const enSubrace of subraceEnEntries) {
        const baseId = getDefaultId(enSubrace);
        let zhSubrace;
        if (enSubrace._isModExpansion) {
            const modKey = `${enSubrace.source}|${enSubrace._originalName || ''}|${enSubrace._versionImplIdx}`;
            zhSubrace = zhModMap.get(modKey);
        } else {
            zhSubrace = subraceZhMap.get(baseId);
        }

        const superiorRaceName = classNameMap.get(enSubrace.raceName) || enSubrace.raceName;
        const superiorId = `${superiorRaceName}|${enSubrace.raceSource || enSubrace.source}`;

        const isMod = enSubrace._isModExpansion || enSubrace._isStandalonePage === false;
        const dataType = isMod ? 'racemod' : 'race';

        const entityBase = buildEntityBase(
            enSubrace,
            zhSubrace,
            subraceEnMap,
            subraceReprintMap,
            subraceFluffStore.getFull(baseId),
            dataType,
            baseId
        );

        if (!entityBase.creatureTypes) {
            entityBase.creatureTypes = ['humanoid'];
        }

        const itemBase: Record<string, any> = {
            ...entityBase,
        };
        const itemEntries = Object.entries(itemBase);
        const abilityIndex = itemEntries.findIndex(([key]) => key === 'ability');
        
        const item: Record<string, any> = {};
        if (abilityIndex >= 0) {
            for (let i = 0; i < abilityIndex; i++) {
                item[itemEntries[i][0]] = itemEntries[i][1];
            }
            item.baserace = superiorRaceName;
            for (let i = abilityIndex; i < itemEntries.length; i++) {
                item[itemEntries[i][0]] = itemEntries[i][1];
            }
        } else {
            item.baserace = superiorRaceName;
            Object.assign(item, itemBase);
        }
        
        item.superiorfork = buildSuperiorfork({
            superior: superiorId,
            fork: 1,
        });
        const rawSuperiorCore = raceCoreMap.get(superiorId) || {};
        const filteredSuperiorCore: Record<string, any> = {};
        for (const [key, value] of Object.entries(rawSuperiorCore)) {
            if (!(enSubrace.overwrite?.[key] ?? false)) {
                filteredSuperiorCore[key] = value;
            }
        }
        item.superiorcore = filteredSuperiorCore;
        item.foundry = raceFoundryStore.getFull(baseId);

        if (isMod) {
            subraceModOutput.push(item);
        } else {
            subraceOutput.push(item);
        }
    }

    const raceOutputDir = path.join('./output', 'race');
    await fs.mkdir(raceOutputDir, { recursive: true });
    const raceWrittenFileNames = new Map<string, Set<string>>();

    for (const item of raceOutput) {
        const raceName = (item.displayName.en || item.id.split('|')[0] || 'other').toLowerCase();
        const sourceId = escapeFileName(item.mainSource.source);
        const sourceDir = path.join(raceOutputDir, raceName, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const idName = item.id.split('|')[0];
        const baseName = escapeFileName(mwUtil.getMwTitle(idName));
        const preferredFileName = `${baseName}.json`;

        const key = `${raceName}|${sourceId}`;
        if (!raceWrittenFileNames.has(key)) {
            raceWrittenFileNames.set(key, new Set<string>());
        }
        const usedNames = raceWrittenFileNames.get(key)!;

        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    const subraceOutputDir = path.join('./output', 'race');
    await fs.mkdir(subraceOutputDir, { recursive: true });
    const subraceWrittenFileNames = new Map<string, Set<string>>();

    for (const item of subraceOutput) {
        const raceName = item.superiorfork?.superior?.split('|')[0]?.toLowerCase() || 'other';
        const sourceId = escapeFileName(item.mainSource.source);
        const sourceDir = path.join(subraceOutputDir, raceName, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const idName = item.id.split('|')[0];
        const baseName = escapeFileName(mwUtil.getMwTitle(idName));
        const preferredFileName = `${baseName}.json`;

        const key = `${raceName}|${sourceId}`;
        if (!subraceWrittenFileNames.has(key)) {
            subraceWrittenFileNames.set(key, new Set<string>());
        }
        const usedNames = subraceWrittenFileNames.get(key)!;

        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    for (const item of subraceModOutput) {
        const raceName = item.superiorfork?.superior?.split('|')[0]?.toLowerCase() || 'other';
        const sourceId = escapeFileName(item.mainSource.source);
        const sourceDir = path.join(subraceOutputDir, raceName, sourceId);
        await fs.mkdir(sourceDir, { recursive: true });

        const idName = item.id.split('|')[0];
        const baseName = escapeFileName(mwUtil.getMwTitle(idName));
        const preferredFileName = `${baseName}.json`;

        const key = `${raceName}|${sourceId}`;
        if (!subraceWrittenFileNames.has(key)) {
            subraceWrittenFileNames.set(key, new Set<string>());
        }
        const usedNames = subraceWrittenFileNames.get(key)!;

        const fileName = resolveCaseInsensitiveOutputFileName(usedNames, preferredFileName, item.id);
        const filePath = path.join(sourceDir, fileName);
        await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');
    }

    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    const raceNamelistData = raceOutput.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || '',
        ishomebrew: !!item.ishomebrew,
        superior: item.superiorfork?.superior || '',
        races: item.races || [],
    }));

    const subraceNamelistData = subraceOutput.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || '',
        ishomebrew: !!item.ishomebrew,
        superior: item.superiorfork?.superior || '',
        races: [],
    }));

    const subraceModNamelistData = subraceModOutput.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || '',
        ishomebrew: !!item.ishomebrew,
        superior: item.superiorfork?.superior || '',
        races: [],
    }));

    const combinedNamelistData = [...raceNamelistData, ...subraceNamelistData];

    const raceOutputNamelist = {
        type: 'race',
        data: combinedNamelistData,
        mod: subraceModNamelistData,
    };

    const raceOutputPath = path.join(namelistDir, 'racenamelist.json');
    await fs.writeFile(raceOutputPath, JSON.stringify(raceOutputNamelist, null, 2), 'utf-8');
    console.log(`已生成 racenamelist.json 文件：${raceOutputPath}`);

    return {
        count: raceOutput.length + subraceOutput.length + subraceModOutput.length,
        raceCount: raceOutput.length,
        subraceCount: subraceOutput.length,
        subraceModCount: subraceModOutput.length,
        data: [...raceOutput, ...subraceOutput, ...subraceModOutput],
    };
};