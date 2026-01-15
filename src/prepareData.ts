import * as fs from 'fs/promises';
import { inspect } from 'node:util';
import { loadFile } from './config.js';
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

    // 生成日志文件
    logStep('finalize');
    await logger.generateFile();
    await idMgr.generateFiles();
    await tagParser.generateFiles();
})().catch(error => {
    console.error('[prepareData] failed');
    console.error(inspect(error, { depth: 8, showHidden: true }));
});
