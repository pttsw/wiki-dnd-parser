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

type EnglishOnlyKeysConfig = Record<string, string[] | undefined> & {
    aliases?: Record<string, string>;
};

const loadEnglishOnlyConfig = (): EnglishOnlyKeysConfig => {
    const configPath = path.resolve('./config/english-only-keys.json');
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content) as EnglishOnlyKeysConfig;
    } catch {
        return {};
    }
};

const englishOnlyConfig = loadEnglishOnlyConfig();

// 获取指定类别“优先英文、无英文回退中文、作为顶层键”的键集合
export const getEnglishOnlyKeys = (category: string): Set<string> => {
    const direct = englishOnlyConfig[category];
    if (Array.isArray(direct)) return new Set(direct);
    const aliasTarget = englishOnlyConfig.aliases?.[category];
    if (aliasTarget) {
        return new Set(englishOnlyConfig[aliasTarget] || []);
    }
    return new Set();
};

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
        englishOnlyKeys?: Set<string>;
    }
) => {
    const emptyZhValue = options?.emptyZhValue ?? '';
    const skipKeys = new Set(options?.skipKeys || []);
    const englishOnlyKeys = new Set(options?.englishOnlyKeys || []);
    const common: Record<string, any> = {};
    const enOut: Record<string, any> = {};
    const zhOut: Record<string, any> = {};
    const keys = getAllKeys(en, zh);

    for (const key of keys) {
        if (skipKeys.has(key)) continue;
        const enValue = en ? en[key] : undefined;
        const zhValue = zh ? zh[key] : undefined;
        // 特殊字段：优先英文，无英文回退中文，始终作为顶层键
        if (englishOnlyKeys.has(key)) {
            if (enValue !== undefined) common[key] = enValue;
            else if (zhValue !== undefined) common[key] = zhValue;
            continue;
        }
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

    stripNestedEnglishOnly(enOut, zhOut, common, englishOnlyKeys);

    return { common, en: enOut, zh: zhOut };
};

// 递归清理嵌套在局部化对象内部的 englishOnly 键：
// 找到 englishOnly 键后，将“英文优先、无英文则中文”的值提升到 topLevel（顶层 common），
// 并从英文、中文两侧的嵌套对象中同时删除该键，避免 zh/en 里各保留一份。
const stripNestedEnglishOnly = (
    enObj: unknown,
    zhObj: unknown,
    topLevel: Record<string, any>,
    englishOnlyKeys: Set<string>
): void => {
    if (!zhObj || typeof zhObj !== 'object') {
        if (!enObj || typeof enObj !== 'object') return;
        // 中文侧缺失，但英文对象仍可能存在 englishOnly 键
        if (Array.isArray(enObj)) return;
        const enRecord = enObj as Record<string, any>;
        for (const key of Object.keys(enRecord)) {
            if (englishOnlyKeys.has(key) && enRecord[key] !== undefined) {
                if (topLevel[key] === undefined) topLevel[key] = enRecord[key];
                delete enRecord[key];
            }
        }
        return;
    }

    if (Array.isArray(zhObj)) {
        if (!Array.isArray(enObj)) return;
        for (let i = 0; i < zhObj.length; i++) {
            const enItem = enObj[i];
            const zhItem = zhObj[i];
            if (zhItem && typeof zhItem === 'object') {
                stripNestedEnglishOnly(enItem, zhItem, topLevel, englishOnlyKeys);
            }
        }
        return;
    }

    const zhRecord = zhObj as Record<string, any>;
    const enRecord = enObj && typeof enObj === 'object' ? (enObj as Record<string, any>) : undefined;

    for (const key of Object.keys(zhRecord)) {
        if (englishOnlyKeys.has(key)) {
            // 英文优先，无英文则用中文兜底
            const value = enRecord && enRecord[key] !== undefined ? enRecord[key] : zhRecord[key];
            if (value !== undefined && topLevel[key] === undefined) {
                topLevel[key] = value;
            }
            if (enRecord) delete enRecord[key];
            delete zhRecord[key];
            continue;
        }
        const enChild = enRecord ? enRecord[key] : undefined;
        const zhChild = zhRecord[key];
        if (zhChild && typeof zhChild === 'object') {
            stripNestedEnglishOnly(enChild, zhChild, topLevel, englishOnlyKeys);
        }
    }
};

export { stripNestedEnglishOnly };

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