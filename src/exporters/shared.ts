import { createHash } from 'crypto';
import path from 'path';
import { i18nKeyRules } from '../i18n.js';

export const escapeFileName = (name: string): string => {
    return name
        .replace(/\\/g, '_0_')
        .replace(/\//g, '_1_')
        .replace(/:/g, '_2_')
        .replace(/\*/g, '_3_')
        .replace(/"/g, '_4_')
        .replace(/</g, '_5_')
        .replace(/>/g, '_6_')
        .replace(/\|/g, '_7_')
        .replace(/\?/g, '_8_');
};

export const getCanonicalName = (item?: { ENG_name?: string; name?: string } | null): string => {
    const name = item?.ENG_name || item?.name || '';
    return name.trim();
};

export const getDefaultId = (item?: { ENG_name?: string; name?: string; source?: string } | null): string => {
    const name = getCanonicalName(item);
    const source = item?.source || '';
    return `${name}|${source}`;
};

export const parseReprintedAsSources = (
    reprintedAs?: (string | { uid: string; tag?: string })[]
): { source: string; page: number }[] => {
    if (!reprintedAs) return [];
    return reprintedAs.map(entry => {
        const str = typeof entry === 'string' ? entry : entry.uid;
        const source = str.split('|').pop() || '';
        return { source, page: 0 };
    });
};

export const normalizeReprintedAs = (
    reprintedAs?: (string | { uid: string; tag?: string })[]
): string[] => {
    if (!reprintedAs) return [];
    return reprintedAs.map(entry => (typeof entry === 'string' ? entry : entry.uid));
};

const hasTextContent = (value: unknown): boolean => {
    if (typeof value === 'string') return true;
    if (Array.isArray(value)) return value.some(hasTextContent);
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some(hasTextContent);
    }
    return false;
};

export const appendEnglishShadowFields = (
    zhOut: Record<string, any>,
    enOut: Record<string, any>
) => {
    for (const [key, zhValue] of Object.entries(zhOut)) {
        if (key.endsWith('_en')) continue;
        const enValue = enOut[key];
        if (enValue === undefined) continue;
        if (!hasTextContent(zhValue) && !hasTextContent(enValue)) continue;
        const enKey = `${key}_en`;
        if (zhOut[enKey] === undefined) {
            zhOut[enKey] = enValue;
        }
    }
};

export const resolveCaseInsensitiveOutputFileName = (
    usedFileNames: Set<string>,
    preferredFileName: string,
    uniqueSeed: string
): string => {
    const normalize = (value: string) => value.toLocaleLowerCase('en-US');
    const preferredKey = normalize(preferredFileName);
    if (!usedFileNames.has(preferredKey)) {
        usedFileNames.add(preferredKey);
        return preferredFileName;
    }

    const ext = path.extname(preferredFileName);
    const base = ext ? preferredFileName.slice(0, -ext.length) : preferredFileName;
    const hash = createHash('sha1').update(uniqueSeed).digest('hex').slice(0, 8);
    let counter = 1;

    while (true) {
        const suffix = counter === 1 ? hash : `${hash}_${counter}`;
        const nextFileName = `${base}_${suffix}${ext}`;
        const nextKey = normalize(nextFileName);
        if (!usedFileNames.has(nextKey)) {
            usedFileNames.add(nextKey);
            return nextFileName;
        }
        counter += 1;
    }
};

export const buildSuperiorfork = (
    hierarchy: {
        origin?: string;
        superior?: string;
        fork?: number;
    },
    inheritsreq = false
): Record<string, any> | undefined => {
    const superiorfork: Record<string, any> = {};
    if (typeof hierarchy.origin === 'string' && hierarchy.origin.trim() !== '') {
        superiorfork.origin = hierarchy.origin;
    }
    if (typeof hierarchy.superior === 'string' && hierarchy.superior.trim() !== '') {
        superiorfork.superior = hierarchy.superior;
    }
    if (typeof hierarchy.fork === 'number') {
        superiorfork.fork = hierarchy.fork;
    }
    if (inheritsreq) {
        superiorfork.inheritsreq = true;
    }
    return Object.keys(superiorfork).length > 0 ? superiorfork : undefined;
};

export const extractTranslator = (
    common: Record<string, any>,
    enOut: Record<string, any>,
    zhOut: Record<string, any>,
    zhRaw?: { translator?: string } | null,
    enRaw?: { translator?: string } | null
): string | undefined => {
    const candidates = [
        common.translator,
        zhOut.translator,
        enOut.translator,
        zhRaw?.translator,
        enRaw?.translator,
    ];
    delete common.translator;
    delete zhOut.translator;
    delete enOut.translator;

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim() !== '') {
            return candidate.trim();
        }
    }
    return undefined;
};

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
            if (
                hasLocalizedDifference(
                    (enValue as Record<string, unknown>)[key],
                    (zhValue as Record<string, unknown>)[key]
                )
            ) {
                return true;
            }
        }
        return false;
    }
    return false;
};

export const splitStructuredRecordByDiff = (
    en: Record<string, any> | null | undefined,
    zh: Record<string, any> | null | undefined,
    options?: {
        emptyZhValue?: string;
        forceLocalizedKeys?: string[];
        forceCommonKeys?: string[];
        skipKeys?: string[];
    }
) => {
    const emptyZhValue = options?.emptyZhValue ?? '';
    const skipKeys = new Set(options?.skipKeys || []);
    const forceLocalizedKeys = new Set(
        options?.forceLocalizedKeys || i18nKeyRules.forceLocalizedKeys || []
    );
    const forceCommonKeys = new Set(options?.forceCommonKeys || []);

    const common: Record<string, any> = {};
    const enOut: Record<string, any> = {};
    const zhOut: Record<string, any> = {};
    const keys = new Set([...Object.keys(en || {}), ...Object.keys(zh || {})]);

    for (const key of keys) {
        if (skipKeys.has(key)) continue;

        const enValue = en?.[key];
        const zhValue = zh?.[key];

        if (forceCommonKeys.has(key)) {
            if (enValue !== undefined) common[key] = enValue;
            else if (zhValue !== undefined) common[key] = zhValue;
            continue;
        }

        const shouldLocalize =
            forceLocalizedKeys.has(key) || hasLocalizedDifference(enValue, zhValue);

        if (shouldLocalize) {
            if (enValue !== undefined) enOut[key] = enValue;
            if (zhValue !== undefined) {
                zhOut[key] = zhValue;
            } else if (enValue !== undefined) {
                zhOut[key] = emptyZhValue;
            }
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

export const normalizeSourceEntries = (sources?: { source?: string; page?: number }[]) =>
    (sources || [])
        .filter(item => typeof item?.source === 'string' && item.source.trim() !== '')
        .map(item => ({
            source: item.source!.trim(),
            page: item.page || 0,
        }));

export const getDirectSources = (item: Record<string, any>) => {
    const sources: { source: string; page: number }[] = [];
    if (item.source) {
        sources.push({ source: item.source, page: item.page || 0 });
    }
    sources.push(...normalizeSourceEntries(item.otherSources));
    sources.push(...normalizeSourceEntries(item.additionalSources));
    sources.push(...parseReprintedAsSources(item.reprintedAs));
    return sources;
};

export const buildReprintMap = (
    entries: Record<string, any>[],
    getId: (item: Record<string, any>) => string
) => {
    const reprintMap = new Map<string, string[]>();
    for (const entry of entries) {
        const id = getId(entry);
        for (const target of normalizeReprintedAs(entry.reprintedAs)) {
            if (!reprintMap.has(target)) {
                reprintMap.set(target, []);
            }
            reprintMap.get(target)!.push(id);
        }
    }
    return reprintMap;
};

export const collectRelatedIds = (
    startId: string,
    entryMap: Map<string, Record<string, any>>,
    reprintMap: Map<string, string[]>
) => {
    const visited = new Set<string>();
    const stack = [startId];

    while (stack.length > 0) {
        const currentId = stack.pop()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const current = entryMap.get(currentId);
        if (current) {
            for (const nextId of normalizeReprintedAs(current.reprintedAs)) {
                if (!visited.has(nextId)) stack.push(nextId);
            }
        }

        for (const nextId of reprintMap.get(currentId) || []) {
            if (!visited.has(nextId)) stack.push(nextId);
        }
    }

    return [...visited];
};

export const buildAllSources = (
    ids: string[],
    entryMap: Map<string, Record<string, any>>
) => {
    const sources: { source: string; page: number }[] = [];
    const seen = new Set<string>();

    const addSource = (source: string, page: number) => {
        if (!source) return;
        const key = `${source}|${page}`;
        if (seen.has(key)) return;
        seen.add(key);
        sources.push({ source, page });
    };

    for (const relatedId of ids) {
        const relatedEntry = entryMap.get(relatedId);
        if (!relatedEntry) {
            const fallbackSource = relatedId.split('|').pop();
            if (fallbackSource) addSource(fallbackSource, 0);
            continue;
        }

        for (const sourceEntry of getDirectSources(relatedEntry)) {
            addSource(sourceEntry.source, sourceEntry.page);
        }
    }

    return sources;
};
