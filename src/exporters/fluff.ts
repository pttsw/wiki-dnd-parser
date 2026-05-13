import { getDefaultId } from './shared.js';

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

const toCopyId = (copy: Record<string, any>, fallbackSource?: string) => {
    const source = copy.source || fallbackSource;
    if (!source || !copy.name) return undefined;
    return getDefaultId({
        ENG_name: copy.ENG_name,
        name: copy.name,
        source,
    });
};

export const resolveFluffContent = (
    item: Record<string, any> | undefined,
    fluffMap: Map<string, Record<string, any>>,
    visited = new Set<string>()
): { entries?: any[]; images?: any[] } | undefined => {
    if (!item) return undefined;

    const copy = item._copy;
    let inherited: { entries?: any[]; images?: any[] } | undefined;

    if (copy?.name) {
        const copyId = toCopyId(copy, item.source);
        if (copyId && !visited.has(copyId)) {
            visited.add(copyId);
            inherited = resolveFluffContent(fluffMap.get(copyId), fluffMap, visited);
        }
    }

    let entries: any[] | undefined = item.entries ?? inherited?.entries;
    let images: any[] | undefined = item.images ?? inherited?.images;

    entries = applyArrayCopyMod(entries, copy?._mod?.entries);
    images = applyArrayCopyMod(images, copy?._mod?.images);

    if (!entries && !images) return undefined;
    return { entries, images };
};

export const buildFluffStore = (
    zhEntries: Record<string, any>[] | undefined,
    enEntries: Record<string, any>[] | undefined,
    getId: (item: Record<string, any>) => string = getDefaultId
) => {
    const maps = {
        zh: new Map<string, Record<string, any>>(),
        en: new Map<string, Record<string, any>>(),
    };

    for (const item of enEntries || []) {
        maps.en.set(getId(item), item);
    }
    for (const item of zhEntries || []) {
        maps.zh.set(getId(item), item);
    }

    return {
        zh: maps.zh,
        en: maps.en,
        getFull(id: string) {
            const fullEn = resolveFluffContent(maps.en.get(id), maps.en);
            const fullZh = resolveFluffContent(maps.zh.get(id), maps.zh);
            if (!fullEn && !fullZh) return undefined;
            return {
                en: fullEn,
                zh: fullZh,
            };
        },
    };
};
