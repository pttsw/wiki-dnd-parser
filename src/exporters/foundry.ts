import { getDefaultId, getCanonicalName } from './shared.js';

export const buildFoundryStore = (
    zhEntries: Record<string, any>[] | undefined,
    enEntries: Record<string, any>[] | undefined,
    getId: (item: Record<string, any>) => string = getDefaultId
) => {
    const maps = {
        zh: new Map<string, Record<string, any>>(),
        en: new Map<string, Record<string, any>>(),
    };

    const nameMaps = {
        zh: new Map<string, Record<string, any>>(),
        en: new Map<string, Record<string, any>>(),
    };

    for (const item of enEntries || []) {
        const id = getId(item);
        maps.en.set(id, item);
        
        const name = getCanonicalName(item);
        if (!nameMaps.en.has(name)) {
            nameMaps.en.set(name, item);
        }
    }
    for (const item of zhEntries || []) {
        const id = getId(item);
        maps.zh.set(id, item);
        
        const name = getCanonicalName(item);
        if (!nameMaps.zh.has(name)) {
            nameMaps.zh.set(name, item);
        }
    }

    return {
        zh: maps.zh,
        en: maps.en,
        getFull(id: string) {
            const enItem = maps.en.get(id);
            const zhItem = maps.zh.get(id);
            
            if (enItem || zhItem) {
                return {
                    en: enItem,
                    zh: zhItem,
                };
            }

            const name = id.split('|')[0];
            const nameEnItem = nameMaps.en.get(name);
            const nameZhItem = nameMaps.zh.get(name);
            
            if (nameEnItem || nameZhItem) {
                return {
                    en: nameEnItem,
                    zh: nameZhItem,
                };
            }

            return undefined;
        },
    };
};