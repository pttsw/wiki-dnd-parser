import { promises as fs } from 'fs';
import path from 'path';
import config from './config.js';

export const isHomebrewMode = process.argv.includes('--homebrew');
export const isPartneredMode = process.argv.includes('--partnered');

/**
 * 官方数据文件名 → homebrew 数据键的映射。
 * 用于 BaseExporter、genericFileExporter、prepareData 等模块自动加载 homebrew 数据。
 */
export const HOMEBREW_FILE_MAP: Record<string, string[]> = {
    'books.json': ['book'],
    'items-base.json': ['baseitem'],
    'items.json': ['item'],
    'backgrounds.json': ['background'],
    'trapshazards.json': ['trap'],
    'vehicles.json': ['vehicle'],
    'variantrules.json': ['variantrule'],
    'cultsboons.json': ['boon'],
    'charcreationoptions.json': ['charoption'],
};

/**
 * 数据键名与目录名不一致的例外映射。
 * 未列出的键默认尝试同名目录（如 'spell' → 'spell/'）。
 * 注意：collection 数据已在 getCnRepo:homebrew 阶段剪切到对应类别目录，此处无需处理 collection。
 */
const KEY_DIR_EXCEPTIONS: Record<string, string[]> = {
    'monster': ['creature', 'creatures'],
    'classFeature': ['class'],
    'subclassFeature': ['subclass'],
    'race': ['subrace', 'race'],
    'trap': ['trapshazard', 'trapshazards'],
    'hazard': ['trapshazard', 'trapshazards'],
    'boon': ['boon', 'cultboon'],
    'cult': ['cultboon'],
    'charoption': ['charoption', 'charcreationoption'],
    'vehicle': ['vehicle', 'vehicles'],
    'variantrule': ['variantrule', 'variantrules'],
    'deity': ['deity', 'deities'],
    'legendaryGroup': ['creature', 'creatures', 'legendarygroup', 'legend'],
};

const getDirsForKey = (key: string): string[] => {
    return KEY_DIR_EXCEPTIONS[key] || [key];
};

const readJson = async <T>(filePath: string): Promise<T> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
};

/**
 * 判断是否应跳过该数据键。
 * 跳过 _ 和 $ 开头的键（元数据），以及 foundry* 前缀的键（Foundry 专用数据）。
 */
const shouldSkipKey = (key: string): boolean => {
    return key.startsWith('_') || key.startsWith('$') || key.startsWith('foundry');
};

// ==================== 缓存 ====================

// 按键缓存数据
const keyDataCache: Record<'en' | 'zh', Map<string, any[]>> = {
    en: new Map(),
    zh: new Map(),
};

// 文件级缓存：同一文件只解析一次
const fileCache: Record<'en' | 'zh', Map<string, Record<string, any>>> = {
    en: new Map(),
    zh: new Map(),
};

// loadAllHomebrewFiles 缓存：locale + keys 排序后作为 key
const allHomebrewFilesCache: Record<'en' | 'zh', Map<string, Record<string, any>[]>> = {
    en: new Map(),
    zh: new Map(),
};

const readJsonCached = async (locale: 'en' | 'zh', filePath: string): Promise<Record<string, any> | null> => {
    const cached = fileCache[locale].get(filePath);
    if (cached) return cached;
    try {
        const data = await readJson<Record<string, any>>(filePath);
        fileCache[locale].set(filePath, data);
        return data;
    } catch {
        return null;
    }
};

// ==================== Partnered 模式逻辑 ====================

/**
 * 合作方 source 标识符缓存（按 locale）。
 * 从 collection/ 文件中提取所有带有 partnered: true 的 source.json 值。
 */
const partneredSourceCache: Record<string, Set<string> | null> = {
    en: null,
    zh: null,
};

/**
 * 从 collection/ 目录中构建合作方 source 标识符集合。
 * 扫描 collection/ 下所有 JSON 文件，提取 _meta.sources 中 partnered: true 的 source.json 值。
 */
const buildPartneredSourceSet = async (locale: 'en' | 'zh'): Promise<Set<string>> => {
    if (partneredSourceCache[locale]) return partneredSourceCache[locale]!;

    const baseDir = locale === 'en' ? config.HOMEBREW_EN_DIR : config.HOMEBREW_ZH_DIR;
    const collectionDir = path.join(baseDir, 'collection');
    const partneredSet = new Set<string>();

    try {
        const files = await fs.readdir(collectionDir);
        await Promise.all(files.map(async (file) => {
            if (!file.endsWith('.json')) return;
            const data = await readJsonCached(locale, path.join(collectionDir, file));
            if (!data) return;
            const sources = data._meta?.sources;
            if (!Array.isArray(sources)) return;
            for (const source of sources) {
                if (source.partnered === true && source.json) {
                    partneredSet.add(source.json);
                }
            }
        }));
    } catch {
        // collection 目录可能不存在，忽略
    }

    partneredSourceCache[locale] = partneredSet;
    return partneredSet;
};

/**
 * 判断 JSON 数据是否包含第三方合作（partnered）来源标记。
 * 检查逻辑（按优先级）：
 *   1. 数据本身有 _meta.sources[].partnered === true
 *   2. 数据本身无 _meta，但数据项中的 source 字段匹配 partneredSources 集合
 *      （适用于 spell/、item/ 等纯数据文件，其 partnered 信息在 collection/ 文件中）
 */
const hasPartneredMeta = (data: Record<string, any> | null, partneredSources?: Set<string>): boolean => {
    if (!data) return false;

    // 检查 1：数据自身的 _meta.sources
    const sources = data._meta?.sources;
    if (Array.isArray(sources) && sources.some((s: any) => s.partnered === true)) {
        return true;
    }

    // 检查 2：通过数据项中的 source 字段匹配合作方来源集合
    if (partneredSources && partneredSources.size > 0) {
        for (const key of Object.keys(data)) {
            if (key === '_meta' || key.startsWith('$')) continue;
            if (Array.isArray(data[key])) {
                for (const item of data[key]) {
                    if (item.source && partneredSources.has(item.source)) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
};

// ==================== Public API ====================

/**
 * 加载 homebrew 中指定数据键的数组数据。
 * 扫描对应类别目录（collection 数据已在 getCnRepo:homebrew 阶段剪切到类别目录）。
 * 按键缓存，同一键的后续调用直接返回缓存。
 * @param locale 'en' 或 'zh'
 * @param keys 数据键名列表，如 ['spell']、['class', 'classFeature']
 */
export const loadHomebrewByKeys = async (
    locale: 'en' | 'zh',
    keys: string[]
): Promise<Record<string, any[]>> => {
    const baseDir = locale === 'en' ? config.HOMEBREW_EN_DIR : config.HOMEBREW_ZH_DIR;
    const result: Record<string, any[]> = {};

    // 过滤已缓存的键
    const keysToLoad = keys.filter(key => {
        const cached = keyDataCache[locale].get(key);
        if (cached) {
            result[key] = cached;
            return false;
        }
        return true;
    });

    if (keysToLoad.length === 0) return result;

    // 收集分类目录 → 需提取的键（同一目录只读一次，提取多个键）
    const dirToKeys = new Map<string, Set<string>>();
    for (const key of keysToLoad) {
        for (const dir of getDirsForKey(key)) {
            if (!dirToKeys.has(dir)) dirToKeys.set(dir, new Set());
            dirToKeys.get(dir)!.add(key);
        }
    }

    // 初始化按键数据容器
    const keyToData: Record<string, any[]> = {};
    for (const key of keysToLoad) {
        keyToData[key] = [];
    }

    // 并行读取分类目录（每个目录只读一次，提取所有所需键）
    // 支持两种模式：
    //   普通模式：优先读取 _all.json（合并文件），不存在则读取单个 JSON 文件
    //   partnered 模式：跳过 _all.json，逐文件读取并按 _meta.sources[].partnered 过滤
    await Promise.all([...dirToKeys.entries()].map(async ([dir, keysInDir]) => {
        const dirPath = path.join(baseDir, dir);

        if (isPartneredMode) {
            // partnered 模式：跳过 _all.json，逐文件读取并过滤
            // 从 collection/ 中构建合作方 source 标识符集合
            const partneredSources = await buildPartneredSourceSet(locale);
            let files: string[];
            try {
                files = await fs.readdir(dirPath);
            } catch {
                return;
            }
            await Promise.all(files.map(async (file) => {
                if (!file.endsWith('.json') || file === '_all.json') return;
                const data = await readJsonCached(locale, path.join(dirPath, file));
                if (!data || !hasPartneredMeta(data, partneredSources)) return;
                for (const key of keysInDir) {
                    if (Array.isArray(data[key])) {
                        for (const item of data[key]) {
                            keyToData[key].push(item);
                        }
                    }
                }
            }));
            return;
        }

        // 普通模式：优先读取 _all.json（合并文件），不存在则读取单个 JSON 文件
        const allJsonPath = path.join(dirPath, '_all.json');
        try {
            await fs.access(allJsonPath);
            const data = await readJsonCached(locale, allJsonPath);
            if (data) {
                for (const key of keysInDir) {
                    if (Array.isArray(data[key])) {
                        for (const item of data[key]) {
                            keyToData[key].push(item);
                        }
                    }
                }
            }
            return;
        } catch {
            // _all.json 不存在，读取该目录下所有独立 JSON 文件
        }
        let files: string[];
        try {
            files = await fs.readdir(dirPath);
        } catch {
            return;
        }
        await Promise.all(files.map(async (file) => {
            if (!file.endsWith('.json') || file === '_all.json') return;
            const data = await readJsonCached(locale, path.join(dirPath, file));
            if (!data) return;
            for (const key of keysInDir) {
                if (Array.isArray(data[key])) {
                    for (const item of data[key]) {
                        keyToData[key].push(item);
                    }
                }
            }
        }));
    }));

    // 缓存并返回
    for (const key of keysToLoad) {
        if (keyToData[key].length > 0) {
            keyDataCache[locale].set(key, keyToData[key]);
            result[key] = keyToData[key];
        }
    }

    return result;
};

/**
 * 加载 homebrew 中包含指定数据键的所有文件（原始 JSON 对象列表）。
 * 扫描对应类别目录。
 * @param locale 'en' 或 'zh'
 * @param keys 需要包含的数据键名列表，如 ['book']、['adventure']
 */
export const loadAllHomebrewFiles = async (
    locale: 'en' | 'zh',
    keys: string[]
): Promise<Record<string, any>[]> => {
    // 缓存 key：keys 排序后拼接
    const cacheKey = [...keys].sort().join(',');
    const cached = allHomebrewFilesCache[locale].get(cacheKey);
    if (cached) return cached;

    const baseDir = locale === 'en' ? config.HOMEBREW_EN_DIR : config.HOMEBREW_ZH_DIR;

    // 收集分类目录
    const dirsSet = new Set<string>();
    for (const key of keys) {
        for (const dir of getDirsForKey(key)) {
            dirsSet.add(dir);
        }
    }

    const result: Record<string, any>[] = [];

    for (const dir of dirsSet) {
        const dirPath = path.join(baseDir, dir);

        if (isPartneredMode) {
            // partnered 模式：跳过 _all.json，逐文件读取并按 partnered 过滤
            const partneredSources = await buildPartneredSourceSet(locale);
            let files: string[];
            try {
                files = await fs.readdir(dirPath);
            } catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith('.json') || file === '_all.json') continue;
                const data = await readJsonCached(locale, path.join(dirPath, file));
                if (data && hasPartneredMeta(data, partneredSources) && keys.some(k => Array.isArray(data[k]) && data[k].length > 0)) {
                    result.push(data);
                }
            }
            continue;
        }

        // 普通模式：优先读取 _all.json（合并文件），不存在则读取单个 JSON 文件
        const allJsonPath = path.join(dirPath, '_all.json');
        try {
            await fs.access(allJsonPath);
            const data = await readJsonCached(locale, allJsonPath);
            if (data && keys.some(k => Array.isArray(data[k]) && data[k].length > 0)) {
                result.push(data);
            }
            continue;
        } catch {
            // _all.json 不存在
        }
        let files: string[];
        try {
            files = await fs.readdir(dirPath);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!file.endsWith('.json') || file === '_all.json') continue;
            const data = await readJsonCached(locale, path.join(dirPath, file));
            if (data && keys.some(k => Array.isArray(data[k]) && data[k].length > 0)) {
                result.push(data);
            }
        }
    }

    allHomebrewFilesCache[locale].set(cacheKey, result);
    return result;
};

/**
 * 扫描所有 homebrew 子目录，合并所有 JSON 文件中的数组数据。
 * @deprecated 此函数加载所有数据，速度较慢。推荐使用 loadHomebrewByKeys。
 */
export const loadAllHomebrewData = async (
    locale: 'en' | 'zh'
): Promise<Record<string, any[]>> => {
    const baseDir = locale === 'en' ? config.HOMEBREW_EN_DIR : config.HOMEBREW_ZH_DIR;
    const result: Record<string, any[]> = {};

    let entries: string[];
    try {
        entries = await fs.readdir(baseDir);
    } catch {
        return result;
    }

    for (const entry of entries) {
        const entryPath = path.join(baseDir, entry);
        let stat;
        try {
            stat = await fs.stat(entryPath);
        } catch {
            continue;
        }
        if (!stat.isDirectory()) continue;

        let files: string[];
        try {
            files = await fs.readdir(entryPath);
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const data = await readJsonCached(locale, path.join(entryPath, file));
            if (!data) continue;
            for (const key of Object.keys(data)) {
                if (shouldSkipKey(key) || !Array.isArray(data[key])) continue;
                if (!result[key]) result[key] = [];
                for (const item of data[key]) {
                    result[key].push(item);
                }
            }
        }
    }

    return result;
};

// ==================== Deprecated（委托给新 API） ====================

export const loadHomebrewCategory = async (
    locale: 'en' | 'zh',
    category: string
): Promise<Record<string, any[]>> => {
    return loadHomebrewByKeys(locale, [category]);
};

export const loadHomebrewCategoryFiles = async (
    locale: 'en' | 'zh',
    category: string
): Promise<Record<string, any>[]> => {
    return loadAllHomebrewFiles(locale, [category]);
};

// ==================== Homebrew source tracking ====================

/**
 * 记录所有 homebrew 数据中的 source 标识符集合。
 * 在 mergeHomebrewBilingual 和直接合并 homebrew 数据时自动填充。
 * 用于在输出文件时添加 ishomebrew 标记。
 */
export const homebrewSources = new Set<string>();

/**
 * 收集 homebrew 数据中所有条目的 source 标识符。
 * 排除官方数据中已有的 source，以确保只标记真正的 homebrew 来源。
 * @param homebrewData homebrew 数据（键为数据类别，值为条目数组）
 * @param officialData 官方数据（可选，用于排除官方已有的 source）
 */
const collectHomebrewSources = (
    homebrewData: Record<string, any[]>,
    officialData?: Record<string, any>
): void => {
    const officialSources = new Set<string>();
    if (officialData) {
        for (const key of Object.keys(officialData)) {
            if (Array.isArray(officialData[key])) {
                for (const item of officialData[key]) {
                    if (item.source) officialSources.add(item.source);
                }
            }
        }
    }
    for (const key of Object.keys(homebrewData)) {
        if (Array.isArray(homebrewData[key])) {
            for (const item of homebrewData[key]) {
                if (item.source && !officialSources.has(item.source)) {
                    homebrewSources.add(item.source);
                }
            }
        }
    }
};

/**
 * 判断给定的 source 标识符是否为 homebrew 来源。
 * 在 homebrew 模式下，如果 source 不在官方数据来源中，则视为 homebrew 来源。
 */
export const isHomebrewSource = (source: string): boolean => {
    if (!isHomebrewMode) return false;
    return homebrewSources.has(source);
};

/**
 * 向 homebrewSources 集合中添加来源标识符。
 * 用于在 prepareData.ts 等模块中直接合并 homebrew 数据时标记来源。
 * @param source 来源标识符
 */
export const addHomebrewSource = (source: string): void => {
    if (isHomebrewMode && source) {
        homebrewSources.add(source);
    }
};

/**
 * 批量收集 homebrew 数据中的来源标识符并添加到 homebrewSources 集合。
 * 用于 prepareData.ts 中直接合并 homebrew 数据的场景。
 * @param homebrewData homebrew 数据（键为数据类别，值为条目数组）
 * @param officialData 官方数据（可选，用于排除官方已有的 source）
 */
export const collectHomebrewItemSources = (
    homebrewData: Record<string, any[]>,
    officialData?: Record<string, any>
): void => {
    if (!isHomebrewMode) return;
    collectHomebrewSources(homebrewData, officialData);
};

/**
 * 清理 homebrewSources 集合（用于测试或重新加载）。
 */
export const clearHomebrewSources = (): void => {
    homebrewSources.clear();
};

// ==================== Merge helpers ====================

export const mergeHomebrewData = (
    officialData: Record<string, any>,
    homebrewData: Record<string, any[]>
): Record<string, any> => {
    const result = { ...officialData };
    for (const key of Object.keys(homebrewData)) {
        if (!result[key]) result[key] = [];
        if (!Array.isArray(result[key])) result[key] = [result[key]];
        for (const item of homebrewData[key]) {
            result[key].push(item);
        }
    }
    return result;
};

export const mergeHomebrewBilingual = async <T extends Record<string, any>>(
    enData: T,
    zhData: T,
    categories: string[]
): Promise<{ en: T; zh: T }> => {
    if (!isHomebrewMode) return { en: enData, zh: zhData };

    const [enHb, zhHb] = await Promise.all([
        loadHomebrewByKeys('en', categories),
        loadHomebrewByKeys('zh', categories),
    ]);

    // 收集 homebrew 来源标识符
    collectHomebrewSources(enHb, enData as Record<string, any>);

    const en = Object.keys(enHb).length > 0 ? mergeHomebrewData(enData, enHb) as T : enData;
    const zh = Object.keys(zhHb).length > 0 ? mergeHomebrewData(zhData, zhHb) as T : zhData;

    return { en, zh };
};