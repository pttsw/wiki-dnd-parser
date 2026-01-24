import * as fs from 'fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import config, { loadFile } from './config.js';
import {
    logger,
    bookMgr,
    featMgr,
    baseItemMgr,
    itemMgr,
    magicVariantMgr,
    itemPropertyMgr,
    itemTypeMgr,
    createOutputFolders,
    idMgr,
    itemFluffMgr,
    spellMgr,
} from './factory.js';
import { ItemFluffFile, MagicVariantFile } from './types/items.js';
import { SpellFile, SpellFileEntry, SpellFluffFile } from './types/spells.js';
import { tagParser } from './contentGen.js';
(process as NodeJS.Process).on('unhandledRejection', reason => {
    console.error('[prepareData] unhandledRejection');
    console.error(inspect(reason, { depth: 8, showHidden: true }));
});
(process as NodeJS.Process).on('uncaughtException', error => {
    console.error('[prepareData] uncaughtException');
    console.error(inspect(error, { depth: 8, showHidden: true }));
});
const resolveParserPath = async (): Promise<string | null> => {
    const candidates = [
        path.join(config.DATA_EN_DIR, 'js', 'parser.js'),
        path.join(path.dirname(config.DATA_EN_DIR), 'js', 'parser.js'),
    ];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // ignore missing candidate
        }
    }
    return null;
};

const loadLegacySources = async (): Promise<Set<string>> => {
    const parserPath = await resolveParserPath();
    if (!parserPath) {
        console.warn('[prepareData] 未找到 parser.js，跳过 newest 计算。');
        return new Set();
    }
    const parserText = await fs.readFile(parserPath, 'utf-8');
    const srcValueMap = new Map<string, string>();
    const srcRegex = /Parser\.SRC_([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = srcRegex.exec(parserText)) !== null) {
        srcValueMap.set(`Parser.SRC_${match[1]}`, match[2]);
    }

    const legacyMatch = parserText.match(
        /Parser\.SOURCES_LEGACY_WOTC\s*=\s*(?:new Set\()?\[([\s\S]*?)\](?:\))?/
    );
    if (!legacyMatch) {
        console.warn('[prepareData] 未找到 Parser.SOURCES_LEGACY_WOTC，跳过 newest 计算。');
        return new Set();
    }

    const legacyBlock = legacyMatch[1];
    const legacyIds = new Set<string>();
    const srcRefs = legacyBlock.match(/Parser\.SRC_[A-Z0-9_]+/g) || [];
    for (const ref of srcRefs) {
        legacyIds.add(srcValueMap.get(ref) ?? ref.replace('Parser.SRC_', ''));
    }
    const directRefs = legacyBlock.match(/['"][^'"]+['"]/g) || [];
    for (const raw of directRefs) {
        legacyIds.add(raw.slice(1, -1));
    }
    return legacyIds;
};

(async () => {
    let step = 'init';
    const logStep = (label: string) => {
        step = label;
        console.log(`[prepareData] ${label}`);
    };
    await createOutputFolders();

    // 基本数据：书
    logStep('books');
    const { en: bookEn, zh: bookZh } = await loadFile('books.json');
    bookMgr.loadData(bookZh, bookEn);
    await bookMgr.generateFiles();

    // 基本数据：特性
    logStep('feats');
    const { en: featEn, zh: featZh } = await loadFile('feats.json');

    featMgr.loadData(featZh, featEn);
    await featMgr.generateFiles();

    // 基本数据：基础物品
    logStep('items-base');
    const { en: itemEn, zh: itemZh } = await loadFile('items-base.json');
    const { en: itemFluffEn, zh: itemFluffZh } = await loadFile('fluff-items.json');
    itemFluffMgr.loadData(itemFluffZh as ItemFluffFile, itemFluffEn as ItemFluffFile);
    itemPropertyMgr.loadData(itemZh, itemEn);
    await itemPropertyMgr.generateFiles();
    itemTypeMgr.loadData(itemZh, itemEn);
    await itemTypeMgr.generateFiles();
    baseItemMgr.loadData(itemZh, itemEn);
    await baseItemMgr.generateFiles();
    // 基本数据：物品
    logStep('items');
    const { en: itemFileEn, zh: itemFileZh } = await loadFile('items.json');
    itemMgr.loadData(itemFileZh, itemFileEn);
    await itemMgr.generateFiles();

    // 基本数据：变体物品
    logStep('magicvariants');
    const { en: magicVariantEn, zh: magicVariantZh } = await loadFile('magicvariants.json');
    magicVariantMgr.loadData(
        magicVariantZh as MagicVariantFile,
        magicVariantEn as MagicVariantFile
    );
    await magicVariantMgr.generateFiles();

    // 法术
    logStep('spells');
    await spellMgr.loadSources('./input/5e-en/data/spells/sources.json');
    const { en: fluffIndexEn = {}, zh: fluffIndexZh = {} } = (await loadFile(
        './spells/fluff-index.json'
    )) as { en?: Record<string, string>; zh?: Record<string, string> };
    const fluffSources = new Set([
        ...Object.keys(fluffIndexEn || {}),
        ...Object.keys(fluffIndexZh || {}),
    ]);
    for (const source of fluffSources) {
        const enFilePath = fluffIndexEn?.[source];
        const zhFilePath = fluffIndexZh?.[source];
        if (enFilePath && enFilePath === zhFilePath) {
            const fluffFilePath = './spells/' + enFilePath;
            const { en: fluffEn, zh: fluffZh } = await loadFile(fluffFilePath);
            spellMgr.loadFluff(fluffZh as SpellFluffFile, fluffEn as SpellFluffFile);
        } else {
            if (enFilePath) {
                const { en: fluffEn } = await loadFile('./spells/' + enFilePath);
                spellMgr.loadFluff(null, fluffEn as SpellFluffFile);
            }
            if (zhFilePath) {
                const { zh: fluffZh } = await loadFile('./spells/' + zhFilePath);
                spellMgr.loadFluff(fluffZh as SpellFluffFile, null);
            }
        }
    }
    const { en: spellIndex } = (await loadFile('./spells/index.json')) as Record<string, string>;
    for (const [source, filePath] of Object.entries(spellIndex)) {
        const spellFilePath = './spells/' + filePath;
        const { en: spellEn, zh: spellZh } = await loadFile(spellFilePath);
        const spellFile = {
            en: spellEn as SpellFile,
            zh: spellZh as SpellFile,
        };
        spellMgr.loadData(spellFile.zh, spellFile.en);
    }
    await spellMgr.generateFiles();

    // 生成来源映射表
    logStep('sources-mapping');
    // 加载books.json
    const { en: sourceBookEn, zh: sourceBookZh } = await loadFile('books.json');
    // 加载adventures.json
    const { en: sourceAdventureEn, zh: sourceAdventureZh } = await loadFile('adventures.json');
    
    const sourceMap: Record<string, any> = {};
    
    // 处理书籍数据
    logStep('processing books');
    // 确保 en.book 和 zh.book 是可迭代对象
    const enBooks = sourceBookEn.book || [];
    const zhBooks = sourceBookZh.book || [];
    
    // 先处理英文书籍，建立基础映射
    for (const enBook of enBooks) {
        if (enBook.id && enBook.name && enBook.published) {
            sourceMap[enBook.id] = {
                id: enBook.id,
                source_name: enBook.name,
                source_published: enBook.published
            };
        }
    }
    
    // 再处理中文书籍，补充中文名称
    for (const zhBook of zhBooks) {
        if (zhBook.id && zhBook.name) {
            // 检查name是否是正常字符串，跳过模板字符串
            const isTemplate = typeof zhBook.name === 'string' && zhBook.name.startsWith('{!@ ');
            let chineseName = '';
            if (!isTemplate && typeof zhBook.name === 'string') {
                chineseName = zhBook.name;
            }
            
            if (sourceMap[zhBook.id]) {
                if (chineseName) {
                    sourceMap[zhBook.id].source_zhname = chineseName;
                }
            } else {
                // 如果没有英文对应，仍然添加中文书籍
                sourceMap[zhBook.id] = {
                    id: zhBook.id,
                    source_name: isTemplate ? zhBook.id : zhBook.name,
                    source_published: zhBook.published || '',
                    source_zhname: chineseName
                };
            }
        }
    }
    
    // 处理模组数据
    logStep('processing adventures');
    // 确保 en.adventure 和 zh.adventure 是可迭代对象
    const enAdventures = sourceAdventureEn.adventure || [];
    const zhAdventures = sourceAdventureZh.adventure || [];
    
    // 先处理英文模组，建立基础映射
    for (const enAdventure of enAdventures) {
        if (enAdventure.id && enAdventure.name && enAdventure.published) {
            sourceMap[enAdventure.id] = {
                id: enAdventure.id,
                source_name: enAdventure.name,
                source_published: enAdventure.published
            };
        }
    }
    
    // 再处理中文模组，补充中文名称
    for (const zhAdventure of zhAdventures) {
        if (zhAdventure.id && zhAdventure.name) {
            // 检查name是否是正常字符串，跳过模板字符串
            const isTemplate = typeof zhAdventure.name === 'string' && zhAdventure.name.startsWith('{!@ ');
            let chineseName = '';
            if (!isTemplate && typeof zhAdventure.name === 'string') {
                chineseName = zhAdventure.name;
            }
            
            if (sourceMap[zhAdventure.id]) {
                if (chineseName) {
                    sourceMap[zhAdventure.id].source_zhname = chineseName;
                }
            } else {
                // 如果没有英文对应，仍然添加中文模组
                sourceMap[zhAdventure.id] = {
                    id: zhAdventure.id,
                    source_name: isTemplate ? zhAdventure.id : zhAdventure.name,
                    source_published: zhAdventure.published || '',
                    source_zhname: chineseName
                };
            }
        }
    }
    
    const legacySources = await loadLegacySources();
    for (const [sourceId, sourceInfo] of Object.entries(sourceMap)) {
        sourceInfo.newest = !legacySources.has(sourceId);
    }

    // 输出到 sources.json
    const sourcesOutputPath = './output/collection/sources.json';
    const sourcesOutput = {
        type: 'sources',
        data: sourceMap
    };
    await fs.writeFile(sourcesOutputPath, JSON.stringify(sourcesOutput, null, 2), 'utf-8');
    
    // 生成日志文件
    logStep('finalize');
    await logger.generateFile();
    await idMgr.generateFiles();
    await tagParser.generateFiles();
})().catch(error => {
    console.error('[prepareData] failed');
    console.error(inspect(error, { depth: 8, showHidden: true }));
});
