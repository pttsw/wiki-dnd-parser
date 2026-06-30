import { createHash } from 'crypto';
import path from 'path';
import { i18nKeyRules } from '../i18n.js';

export const escapeFileName = (name: string): string => {
    return name
        .replace(/\\/g, '_0_')
        .replace(/\//g, '_9_')
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
    return [];
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
    const sourceMap = new Map<string, number>();

    const addSource = (source: string, page: number) => {
        if (!source) return;
        if (!sourceMap.has(source) || page > sourceMap.get(source)!) {
            sourceMap.set(source, page);
        }
    };

    for (const relatedId of ids) {
        const relatedEntry = entryMap.get(relatedId);
        if (!relatedEntry) {
            continue;
        }

        for (const sourceEntry of getDirectSources(relatedEntry)) {
            addSource(sourceEntry.source, sourceEntry.page);
        }
    }

    return [...sourceMap.entries()].map(([source, page]) => ({ source, page }));
};

export class SectionTextIdMap {
    private static instance: SectionTextIdMap;
    private map: Map<string, string> = new Map(); // key: "bookId|chapterIndex|sectionTitle", value: textId
    private bookIdMap: Map<string, Map<string, string>> = new Map(); // key: bookId, value: Map of sectionTitle to textId
    private chapterIndexMap: Map<string, Map<number, Map<string, string>>> = new Map(); // key: bookId, value: Map of chapterIndex to Map of sectionTitle to textId
    private bookIdToTextIdMap: Map<string, string> = new Map(); // key: "bookId|textId", value: textId (for quick lookup)
    private chapterIndexToTextIdMap: Map<string, string> = new Map(); // key: "bookId|chapterIndex", value: textId (direct lookup)
    private chapterIndexToPageTitleMap: Map<string, { zh: string; en: string }> = new Map(); // key: "bookId|chapterIndex", value: { zh: zhPageTitle, en: enPageTitle }
    private chapterIndexToSubpageTitleMap: Map<string, Map<string, { zh: string; en: string }>> = new Map(); // key: "bookId|chapterIndex", value: Map of sectionTitle to { zh: zhPageTitle, en: enPageTitle }
    private sectionTitleToPageTitleMap: Map<string, { zh: string; en: string }> = new Map(); // key: "bookId|sectionTitle", value: { zh: zhPageTitle, en: enPageTitle }
    private allMappings: Array<{ bookId: string; textId: string; chapterIndex?: number; sectionTitle?: string }> = [];

    private constructor() {}

    static getInstance(): SectionTextIdMap {
        if (!SectionTextIdMap.instance) {
            SectionTextIdMap.instance = new SectionTextIdMap();
        }
        return SectionTextIdMap.instance;
    }

    clear(): void {
        this.map.clear();
        this.bookIdMap.clear();
        this.chapterIndexMap.clear();
        this.bookIdToTextIdMap.clear();
        this.chapterIndexToPageTitleMap.clear();
        this.chapterIndexToSubpageTitleMap.clear();
        this.sectionTitleToPageTitleMap.clear();
    }
    
    setPageTitle(bookId: string, chapterIndex: number, zhTitle: string, enTitle: string): void {
        const normalizedBookId = bookId.toLowerCase();
        const key = `${normalizedBookId}|${chapterIndex}`;
        this.chapterIndexToPageTitleMap.set(key, { zh: zhTitle, en: enTitle });
    }
    
    getPageTitle(bookId: string, chapterIndex: string | number, isZh: boolean, sectionTitle?: string): string | null {
        const normalizedBookId = bookId.toLowerCase();
        const key = `${normalizedBookId}|${chapterIndex}`;
        
        if (sectionTitle) {
            const subpageMap = this.chapterIndexToSubpageTitleMap.get(key);
            if (subpageMap) {
                const subpageTitle = subpageMap.get(sectionTitle);
                if (subpageTitle) {
                    return isZh ? subpageTitle.zh : subpageTitle.en;
                }
            }
        }
        
        const title = this.chapterIndexToPageTitleMap.get(key);
        if (title) {
            return isZh ? title.zh : title.en;
        }
        return null;
    }
    
    setSubpageTitle(bookId: string, chapterIndex: number, sectionTitle: string, zhTitle: string, enTitle: string): void {
        const normalizedBookId = bookId.toLowerCase();
        const key = `${normalizedBookId}|${chapterIndex}`;
        
        if (!this.chapterIndexToSubpageTitleMap.has(key)) {
            this.chapterIndexToSubpageTitleMap.set(key, new Map());
        }
        
        this.chapterIndexToSubpageTitleMap.get(key)!.set(sectionTitle, { zh: zhTitle, en: enTitle });
    }

    addMapping(bookId: string, textId: string, chapterIndex?: number, sectionTitle?: string): void {
        const normalizedBookId = bookId.toLowerCase();
        
        if (sectionTitle) {
            const key = `${normalizedBookId}|${chapterIndex ?? 0}|${sectionTitle}`;
            this.map.set(key, textId);
            
            if (!this.bookIdMap.has(normalizedBookId)) {
                this.bookIdMap.set(normalizedBookId, new Map());
            }
            this.bookIdMap.get(normalizedBookId)!.set(sectionTitle, textId);
            
            if (chapterIndex !== undefined) {
                if (!this.chapterIndexMap.has(normalizedBookId)) {
                    this.chapterIndexMap.set(normalizedBookId, new Map());
                }
                if (!this.chapterIndexMap.get(normalizedBookId)!.has(chapterIndex)) {
                    this.chapterIndexMap.get(normalizedBookId)!.set(chapterIndex, new Map());
                }
                this.chapterIndexMap.get(normalizedBookId)!.get(chapterIndex)!.set(sectionTitle, textId);
            }
        }
        
        // ???????bookId|textId -> textId
        this.bookIdToTextIdMap.set(`${normalizedBookId}|${textId}`, textId);
        
        // ???????bookId|chapterIndex -> textId??????
        if (chapterIndex !== undefined) {
            const chapterKey = `${normalizedBookId}|${chapterIndex}`;
            // ??????????????????
            if (!this.chapterIndexToTextIdMap.has(chapterKey)) {
                this.chapterIndexToTextIdMap.set(chapterKey, textId);
            }
        }
        
        // ??????
        this.allMappings.push({ bookId, textId, chapterIndex, sectionTitle });
    }
    
    printStats(): void {
        // ???5???
        for (let i = 0; i < Math.min(5, this.allMappings.length); i++) {
            const m = this.allMappings[i];
            // console.log(`  ${i + 1}. bookId=${m.bookId}, textId=${m.textId}, chapterIndex=${m.chapterIndex}, sectionTitle=${m.sectionTitle}`);
        }
    }

    getTextId(bookId: string, chapterIndexOrTextId?: string | number, sectionTitle?: string): string | null {
        const normalizedBookId = bookId.toLowerCase();
        
        // ??0??????chapterIndexOrTextId??chapterIndex????????textId????
        if (chapterIndexOrTextId !== undefined && typeof chapterIndexOrTextId === 'number') {
            const chapterKey = `${normalizedBookId}|${chapterIndexOrTextId}`;
            if (this.chapterIndexToTextIdMap.has(chapterKey)) {
                return this.chapterIndexToTextIdMap.get(chapterKey)!;
            }
        }
        
        // ??1????chapterIndexOrTextId??textId????
        if (chapterIndexOrTextId !== undefined) {
            const textIdKey = `${normalizedBookId}|${chapterIndexOrTextId}`;
            if (this.bookIdToTextIdMap.has(textIdKey)) {
                return this.bookIdToTextIdMap.get(textIdKey)!;
            }
        }

        // ??2??????bookId + chapterIndex + sectionTitle?
        if (sectionTitle && chapterIndexOrTextId !== undefined) {
            const key = `${normalizedBookId}|${chapterIndexOrTextId}|${sectionTitle}`;
            if (this.map.has(key)) {
                return this.map.get(key)!;
            }
        }

        // ??3????bookId?sectionTitle
        if (sectionTitle) {
            if (this.bookIdMap.has(normalizedBookId)) {
                const bookMap = this.bookIdMap.get(normalizedBookId)!;
                if (bookMap.has(sectionTitle)) {
                    return bookMap.get(sectionTitle)!;
                }
            }
        }

        // ??4???bookId?chapterIndex?sectionTitle??????
        if (sectionTitle && chapterIndexOrTextId !== undefined && typeof chapterIndexOrTextId === 'number' && this.chapterIndexMap.has(normalizedBookId)) {
            const chapterMap = this.chapterIndexMap.get(normalizedBookId)!;
            if (chapterMap.has(chapterIndexOrTextId)) {
                const sectionMap = chapterMap.get(chapterIndexOrTextId)!;
                if (sectionMap.has(sectionTitle)) {
                    return sectionMap.get(sectionTitle)!;
                }
            }
        }
        
        // ??5?????sectionTitle???????????
        if (sectionTitle) {
            const normalizedTitle = sectionTitle.toLowerCase().trim();
            if (this.bookIdMap.has(normalizedBookId)) {
                const bookMap = this.bookIdMap.get(normalizedBookId)!;
                for (const [title, id] of bookMap.entries()) {
                    if (title.toLowerCase().trim() === normalizedTitle) {
                        return id;
                    }
                }
            }
        }
        
        return null;
    }
    
    // ?? sectionTitle ?????? chapterIndex?
    getTextIdByTitleOnly(bookId: string, sectionTitle: string): string | null {
        if (!sectionTitle) return null;
        
        const normalizedBookId = bookId.toLowerCase();
        
        if (this.bookIdMap.has(normalizedBookId)) {
            const bookMap = this.bookIdMap.get(normalizedBookId)!;
            
            // ????
            if (bookMap.has(sectionTitle)) {
                return bookMap.get(sectionTitle)!;
            }
            
            // ??????????????
            const normalizedTitle = sectionTitle.toLowerCase().trim();
            for (const [title, id] of bookMap.entries()) {
                if (title.toLowerCase().trim() === normalizedTitle) {
                    return id;
                }
            }
        }
        
        return null;
    }
    
    // ???? sectionTitle ???? ????
    setSectionTitleToPageTitle(bookId: string, sectionTitle: string, zhPageTitle: string, enPageTitle: string): void {
        const normalizedBookId = bookId.toLowerCase();
        const key = `${normalizedBookId}|${sectionTitle}`;
        this.sectionTitleToPageTitleMap.set(key, { zh: zhPageTitle, en: enPageTitle });
    }
    
    // ???? sectionTitle ????
    getPageTitleBySectionTitle(bookId: string, sectionTitle: string, isZh: boolean): string | null {
        const normalizedBookId = bookId.toLowerCase();
        
        // ????
        const key = `${normalizedBookId}|${sectionTitle}`;
        const title = this.sectionTitleToPageTitleMap.get(key);
        if (title) {
            return isZh ? title.zh : title.en;
        }
        
        // ??????????????
        const normalizedTitle = sectionTitle.toLowerCase().trim();
        for (const [mapKey, mapTitle] of this.sectionTitleToPageTitleMap.entries()) {
            if (mapKey.startsWith(`${normalizedBookId}|`)) {
                const mapSectionTitle = mapKey.substring(normalizedBookId.length + 1);
                if (mapSectionTitle.toLowerCase().trim() === normalizedTitle) {
                    return isZh ? mapTitle.zh : mapTitle.en;
                }
            }
        }
        
        return null;
    }
}

export const sectionTextIdMap = SectionTextIdMap.getInstance();
