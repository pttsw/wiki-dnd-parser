import type {
    MonsterFileEntry,
    MonsterFluffContent,
    MonsterFluffEntry,
} from './types/bestiary.js';

export const getBestiaryId = (monster: Pick<MonsterFileEntry, 'name' | 'ENG_name' | 'source'>) => {
    const name = monster.ENG_name ? monster.ENG_name.trim() : monster.name.trim();
    return `${name}|${monster.source}`;
};

export const normalizeMonsterReferenceSources = (
    monster?: Pick<MonsterFileEntry, 'otherSources'> | null
): { source: string; page: number }[] =>
    (monster?.otherSources || []).map(item => ({
        source: item.source,
        page: item.page || 0,
    }));

export const hasLocalizedDifference = (enValue: unknown, zhValue: unknown): boolean => {
    if (zhValue === undefined || zhValue === null) return false;
    if (typeof enValue === 'string' || typeof zhValue === 'string') {
        return enValue !== zhValue;
    }
    if (Array.isArray(enValue) || Array.isArray(zhValue)) {
        if (!Array.isArray(enValue) || !Array.isArray(zhValue)) return true;
        if (enValue.length !== zhValue.length) return true;
        return enValue.some((item, index) => hasLocalizedDifference(item, zhValue[index]));
    }
    if (enValue && zhValue && typeof enValue === 'object' && typeof zhValue === 'object') {
        const keys = new Set([
            ...Object.keys(enValue as Record<string, unknown>),
            ...Object.keys(zhValue as Record<string, unknown>),
        ]);
        for (const key of keys) {
            if (key === 'ENG_name') continue;
            if (hasLocalizedDifference((enValue as Record<string, unknown>)[key], (zhValue as Record<string, unknown>)[key])) {
                return true;
            }
        }
        return false;
    }
    return false;
};

export const splitBestiaryRecord = (
    en: Record<string, any>,
    zh?: Record<string, any> | null,
    options?: { skipKeys?: string[] }
) => {
    const skipKeys = new Set(options?.skipKeys || []);
    const common: Record<string, any> = {};
    const enOut: Record<string, any> = {};
    const zhOut: Record<string, any> = {};
    const keys = new Set([...Object.keys(en || {}), ...Object.keys(zh || {})]);

    // 翻译表
    const translationMap: Record<string, string> = {
        'Aartuk': '蔬菜人语',
        'darkvision 60 ft': '黑暗视觉60尺'
    };

    // 翻译函数
    const translateValue = (value: string): string => {
        return translationMap[value] || value;
    };

    // 处理senses和languages字段，确保它们有zh和en版本
    const processLocalizedField = (key: string) => {
        const enValue = en?.[key];
        let zhValue = zh?.[key];

        if (enValue !== undefined) {
            enOut[key] = enValue;
        }

        // 如果有中文数据，检查是否需要翻译
        if (zhValue !== undefined) {
            // 如果中文数据和英文数据相同，说明可能没有真正翻译，需要尝试翻译
            const needTranslate = JSON.stringify(zhValue) === JSON.stringify(enValue);
            
            if (needTranslate) {
                // 需要翻译
                if (Array.isArray(enValue)) {
                    zhOut[key] = enValue.map(item => {
                        if (typeof item === 'string') {
                            // 尝试精确匹配翻译
                            if (translationMap[item]) {
                                return translationMap[item];
                            }
                            // 尝试部分匹配（处理包含额外信息的字符串）
                            for (const [enWord, zhWord] of Object.entries(translationMap)) {
                                if (item.includes(enWord)) {
                                    return item.replace(enWord, zhWord);
                                }
                            }
                            return item;
                        }
                        return item;
                    });
                } else if (typeof enValue === 'string') {
                    // 尝试精确匹配翻译
                    if (translationMap[enValue]) {
                        zhOut[key] = translationMap[enValue];
                    } else {
                        // 尝试部分匹配
                        let result = enValue;
                        for (const [enWord, zhWord] of Object.entries(translationMap)) {
                            if (result.includes(enWord)) {
                                result = result.replace(enWord, zhWord);
                            }
                        }
                        zhOut[key] = result;
                    }
                } else {
                    zhOut[key] = enValue;
                }
            } else {
                // 使用已有中文数据
                zhOut[key] = zhValue;
            }
        } else if (enValue !== undefined) {
            // 如果没有中文，尝试翻译
            if (Array.isArray(enValue)) {
                zhOut[key] = enValue.map(item => {
                    if (typeof item === 'string') {
                        // 尝试精确匹配翻译
                        if (translationMap[item]) {
                            return translationMap[item];
                        }
                        // 尝试部分匹配（处理包含额外信息的字符串）
                        for (const [enWord, zhWord] of Object.entries(translationMap)) {
                            if (item.includes(enWord)) {
                                return item.replace(enWord, zhWord);
                            }
                        }
                        return item;
                    }
                    return item;
                });
            } else if (typeof enValue === 'string') {
                // 尝试精确匹配翻译
                if (translationMap[enValue]) {
                    zhOut[key] = translationMap[enValue];
                } else {
                    // 尝试部分匹配
                    let result = enValue;
                    for (const [enWord, zhWord] of Object.entries(translationMap)) {
                        if (result.includes(enWord)) {
                            result = result.replace(enWord, zhWord);
                        }
                    }
                    zhOut[key] = result;
                }
            } else {
                zhOut[key] = enValue;
            }
        }
    };

    for (const key of keys) {
        if (skipKeys.has(key)) continue;

        // 特殊处理senses和languages字段
        if (key === 'senses' || key === 'languages') {
            processLocalizedField(key);
            continue;
        }

        const enValue = en?.[key];
        const zhValue = zh?.[key];
        
        // 特殊处理某些字段，总是使用英文数据
        const englishOnlyKeys = new Set([
            'type',
            'environment',
            'treasure',
            'dragonAge',
            'traitTags',
            'actionTags',
            'conditionInflictSpell',
            'savingThrowForced',
            'savingThrowForcedLegendary',
            'savingThrowForcedSpell',
			'group',
			'initiative'
        ]);
        
        if (englishOnlyKeys.has(key) && enValue !== undefined) {
            common[key] = enValue;
            continue;
        }
        
        if (hasLocalizedDifference(enValue, zhValue)) {
            if (enValue !== undefined) enOut[key] = enValue;
            if (zhValue !== undefined) zhOut[key] = zhValue;
            continue;
        }
        if (enValue !== undefined) {
            common[key] = enValue;
        } else if (zhValue !== undefined) {
            common[key] = zhValue;
        }
    }

    return { common, en: enOut, zh: zhOut };
};

export const toMonsterFluffContent = (
    item?: MonsterFluffEntry
): MonsterFluffContent | undefined => {
    if (!item) return undefined;
    const { entries, images } = item;
    if (!entries && !images) return undefined;
    return { entries, images };
};

const toArrayItems = (value: unknown): any[] => {
    if (value === undefined) return [];
    return Array.isArray(value) ? [...value] : [value];
};

const applyArrayCopyMod = (
    current: any[] | undefined,
    mod?: { mode?: string; items?: unknown }
): any[] | undefined => {
    if (!mod) return current;
    const items = toArrayItems(mod.items);
    if (mod.mode === 'prependArr') {
        return [...items, ...(current || [])];
    }
    if (mod.mode === 'appendArr') {
        return [...(current || []), ...items];
    }
    return current;
};

export const resolveMonsterFluffContent = (
    item: MonsterFluffEntry | undefined,
    fluffMap: Map<string, MonsterFluffEntry>,
    visited = new Set<string>(),
    useCopy = true // 新增参数控制是否使用_copy追踪
): MonsterFluffContent | undefined => {
    if (!item) return undefined;
    
    // 如果不使用_copy追踪，直接返回当前item的内容
    if (!useCopy) {
        const { entries, images } = item;
        if (!entries && !images) return undefined;
        return { entries, images };
    }
    
    const copy = item._copy;
    let inherited: MonsterFluffContent | undefined;
    if (copy?.name && copy?.source) {
        const copyId = `${copy.name}|${copy.source}`;
        if (!visited.has(copyId)) {
            visited.add(copyId);
            inherited = resolveMonsterFluffContent(fluffMap.get(copyId), fluffMap, visited, useCopy);
        }
    }

    let entries = item.entries ?? inherited?.entries;
    let images = item.images ?? inherited?.images;

    entries = applyArrayCopyMod(entries, copy?._mod?.entries);
    images = applyArrayCopyMod(images, copy?._mod?.images);

    if (!entries && !images) return undefined;
    return { entries, images };
};
