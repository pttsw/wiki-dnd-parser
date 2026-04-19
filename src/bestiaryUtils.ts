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

    for (const key of keys) {
        if (skipKeys.has(key)) continue;
        const enValue = en?.[key];
        const zhValue = zh?.[key];
        
        // 特殊处理 type 字段，总是使用英文数据的 type 值
        if (key === 'type' && enValue !== undefined) {
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
    visited = new Set<string>()
): MonsterFluffContent | undefined => {
    if (!item) return undefined;
    const copy = item._copy;
    let inherited: MonsterFluffContent | undefined;
    if (copy?.name && copy?.source) {
        const copyId = `${copy.name}|${copy.source}`;
        if (!visited.has(copyId)) {
            visited.add(copyId);
            inherited = resolveMonsterFluffContent(fluffMap.get(copyId), fluffMap, visited);
        }
    }

    let entries = item.entries ?? inherited?.entries;
    let images = item.images ?? inherited?.images;

    entries = applyArrayCopyMod(entries, copy?._mod?.entries);
    images = applyArrayCopyMod(images, copy?._mod?.images);

    if (!entries && !images) return undefined;
    return { entries, images };
};
