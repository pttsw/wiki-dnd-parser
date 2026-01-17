import fs from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'node:util';

export type I18nKeyRules = {
    forceLocalizedKeys: string[];
    forceCommonKeys: string[];
    weaponKeys: string[];
    armorKeys: string[];
};

export type I18nKeySets = {
    allKeys: Set<string>;
    localizedKeys: Set<string>;
    commonKeys: Set<string>;
};

const loadKeyRules = (): I18nKeyRules => {
    const rulesPath = path.resolve('./config/i18n-key-rules.json');
    const content = fs.readFileSync(rulesPath, 'utf-8');
    const raw = JSON.parse(content) as I18nKeyRules;
    return {
        forceLocalizedKeys: raw.forceLocalizedKeys || [],
        forceCommonKeys: raw.forceCommonKeys || [],
        weaponKeys: raw.weaponKeys || [],
        armorKeys: raw.armorKeys || [],
    };
};

export const i18nKeyRules = loadKeyRules();

type RecordPair = {
    en: Record<string, any> | null | undefined;
    zh: Record<string, any> | null | undefined;
};

const getAllKeys = (en?: Record<string, any> | null, zh?: Record<string, any> | null) => {
    const keys = new Set<string>();
    if (en) {
        for (const key of Object.keys(en)) keys.add(key);
    }
    if (zh) {
        for (const key of Object.keys(zh)) keys.add(key);
    }
    return keys;
};

export const classifyI18nKeys = (
    pairs: RecordPair[],
    rules: I18nKeyRules
): I18nKeySets => {
    const allKeys = new Set<string>();
    const diffKeys = new Set<string>();
    const forceLocalized = new Set(rules.forceLocalizedKeys);
    const forceCommon = new Set(rules.forceCommonKeys);

    for (const pair of pairs) {
        const keys = getAllKeys(pair.en, pair.zh);
        for (const key of keys) {
            allKeys.add(key);
            if (forceLocalized.has(key) || forceCommon.has(key)) continue;
            const enValue = pair.en ? pair.en[key] : undefined;
            const zhValue = pair.zh ? pair.zh[key] : undefined;
            if (!isDeepStrictEqual(enValue, zhValue)) {
                diffKeys.add(key);
            }
        }
    }

    const localizedKeys = new Set<string>([...diffKeys, ...forceLocalized]);
    for (const key of forceCommon) localizedKeys.delete(key);

    const commonKeys = new Set<string>();
    for (const key of allKeys) {
        if (!localizedKeys.has(key)) {
            commonKeys.add(key);
        }
    }

    return { allKeys, localizedKeys, commonKeys };
};

export const splitRecordByI18n = (
    en: Record<string, any> | null | undefined,
    zh: Record<string, any> | null | undefined,
    keySets: I18nKeySets,
    options?: {
        emptyZhValue?: string;
        skipKeys?: string[];
    }
) => {
    const emptyZhValue = options?.emptyZhValue ?? '';
    const skipKeys = new Set(options?.skipKeys || []);
    const common: Record<string, any> = {};
    const enOut: Record<string, any> = {};
    const zhOut: Record<string, any> = {};
    const keys = getAllKeys(en, zh);

    for (const key of keys) {
        if (skipKeys.has(key)) continue;
        const enValue = en ? en[key] : undefined;
        const zhValue = zh ? zh[key] : undefined;
        if (keySets.localizedKeys.has(key)) {
            if (enValue !== undefined) enOut[key] = enValue;
            if (zhValue !== undefined) {
                zhOut[key] = zhValue;
            } else if (enValue !== undefined) {
                zhOut[key] = emptyZhValue;
            }
        } else {
            if (enValue !== undefined) common[key] = enValue;
            else if (zhValue !== undefined) common[key] = zhValue;
        }
    }

    return { common, en: enOut, zh: zhOut };
};

export const buildGroupedBlock = (
    en: Record<string, any> | null | undefined,
    zh: Record<string, any> | null | undefined,
    keys: string[],
    localizedKeys: Set<string>,
    emptyZhValue = ''
) => {
    const common: Record<string, any> = {};
    const enBlock: Record<string, any> = {};
    const zhBlock: Record<string, any> = {};
    let hasCommon = false;
    let hasEn = false;
    let hasZh = false;

    for (const key of keys) {
        const enValue = en ? en[key] : undefined;
        const zhValue = zh ? zh[key] : undefined;
        if (enValue === undefined && zhValue === undefined) continue;
        if (localizedKeys.has(key)) {
            if (enValue !== undefined) {
                enBlock[key] = enValue;
                hasEn = true;
            }
            if (zhValue !== undefined) {
                zhBlock[key] = zhValue;
                hasZh = true;
            } else if (enValue !== undefined) {
                zhBlock[key] = emptyZhValue;
                hasZh = true;
            }
        } else {
            if (enValue !== undefined) {
                common[key] = enValue;
                hasCommon = true;
            } else if (zhValue !== undefined) {
                common[key] = zhValue;
                hasCommon = true;
            }
        }
    }

    if (!hasCommon && !hasEn && !hasZh) {
        return { common: undefined, en: undefined, zh: undefined };
    }

    return {
        common: hasCommon ? common : undefined,
        en: hasEn ? enBlock : undefined,
        zh: hasZh ? zhBlock : undefined,
    };
};
