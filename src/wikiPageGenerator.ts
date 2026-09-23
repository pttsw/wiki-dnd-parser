import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BookFile } from './types/books.js';
import { WikiItemData } from './types/items.js';
import { WikiSpellData } from './types/spells.js';
import { WikiBestiaryData } from './types/bestiary.js';
import { escapeFileName } from './exporters/shared.js';

type PageJsonMapEntry = {
    wikiPath: string;
    jsonPath: string;
    bookId: string;
    pageId: string;
    locale: 'zh' | 'en';
};

const getMwTitle = (title: string): string => {
    return title.trim()
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_CONTENTS_DIR = path.join(__dirname, '..', 'config', 'contents');

interface WikiClassData {
    id: string;
    dataType: string;
    displayName: {
        zh?: string | null;
        en?: string | null;
    };
    mainSource: {
        source: string;
        page: number;
    };
    superiorfork?: {
        fork?: number;
        superior?: string;
    };
    basicRules2024?: boolean;
    zh?: {
        name?: string;
    };
    en?: {
        name?: string;
    };
}

interface WikiRaceData {
    id: string;
    dataType: string;
    displayName: {
        zh?: string | null;
        en?: string | null;
    };
    mainSource: {
        source: string;
        page: number;
    };
    superiorfork?: {
        fork?: number;
        superior?: string;
    };
}

type SourceNameEntry = {
    zh?: string;
    en?: string;
};

type HierarchyInfo = {
    fork: number;
    originId?: string;
    superiorId?: string;
    inheritsreq: boolean;
};

type WikiPageGeneratorOptions = {
    books: {
        en: BookFile;
        zh: BookFile;
    };
    spells: Map<string, WikiSpellData>;
    baseItems: Map<string, WikiItemData>;
    items: Map<string, WikiItemData>;
    magicVariants: Map<string, WikiItemData>;
    bestiary: Map<string, WikiBestiaryData>;
    classes: Map<string, WikiClassData>;
    races: Map<string, WikiRaceData>;
    feats: Map<string, any>;
    backgrounds: Map<string, any>;
    hazards: Map<string, any>;
    traps: Map<string, any>;
    bastions: Map<string, any>;
    boons: Map<string, any>;
    charoptions: Map<string, any>;
    conditions: Map<string, any>;
    decks: Map<string, any>;
    deities: Map<string, any>;
    objects: Map<string, any>;
    optionalfeatures: Map<string, any>;
    rewards: Map<string, any>;
    variantrules: Map<string, any>;
    vehicles: Map<string, any>;
    outputRoot?: string;
    logger?: (message: string) => void;
};

type WikiPageGenerationResult = {
    spellFiles: number;
    itemFiles: number;
    bestiaryFiles: number;
    classFiles: number;
    raceFiles: number;
    featFiles: number;
    backgroundFiles: number;
    hazardFiles: number;
    trapFiles: number;
    bastionFiles: number;
    boonFiles: number;
    charoptionFiles: number;
    conditionFiles: number;
    deckFiles: number;
    deityFiles: number;
    objectFiles: number;
    optionalfeatureFiles: number;
    rewardFiles: number;
    variantruleFiles: number;
    vehicleFiles: number;
    failed: number;
    skippedSelfRedirects: number;
    pageConflicts: number;
};

export class WikiPageGenerator {
    private readonly outputRoot: string;
    private readonly spellsDir: string;
    private readonly itemsDir: string;
    private readonly bestiaryDir: string;
    private readonly classesDir: string;
    private readonly racesDir: string;
    private readonly featsDir: string;
    private readonly backgroundsDir: string;
    private readonly hazardsDir: string;
    private readonly trapsDir: string;
    private readonly bastionsDir: string;
    private readonly boonsDir: string;
    private readonly charoptionsDir: string;
    private readonly conditionsDir: string;
    private readonly decksDir: string;
    private readonly deitiesDir: string;
    private readonly objectsDir: string;
    private readonly optionalfeaturesDir: string;
    private readonly rewardsDir: string;
    private readonly variantrulesDir: string;
    private readonly vehiclesDir: string;
    private readonly spells: Map<string, WikiSpellData>;
    private readonly itemIndex: Map<string, WikiItemData> = new Map();
    private readonly bestiaryIndex: Map<string, WikiBestiaryData> = new Map();
    private readonly classIndex: Map<string, WikiClassData> = new Map();
    private readonly raceIndex: Map<string, WikiRaceData> = new Map();
    private readonly featIndex: Map<string, any> = new Map();
    private readonly backgroundIndex: Map<string, any> = new Map();
    private readonly hazardIndex: Map<string, any> = new Map();
    private readonly trapIndex: Map<string, any> = new Map();
    private readonly bastionIndex: Map<string, any> = new Map();
    private readonly boonIndex: Map<string, any> = new Map();
    private readonly charoptionIndex: Map<string, any> = new Map();
    private readonly conditionIndex: Map<string, any> = new Map();
    private readonly deckIndex: Map<string, any> = new Map();
    private readonly deityIndex: Map<string, any> = new Map();
    private readonly objectIndex: Map<string, any> = new Map();
    private readonly optionalfeatureIndex: Map<string, any> = new Map();
    private readonly rewardIndex: Map<string, any> = new Map();
    private readonly variantruleIndex: Map<string, any> = new Map();
    private readonly vehicleIndex: Map<string, any> = new Map();
    private readonly sourceNames: Map<string, SourceNameEntry> = new Map();
    private readonly writtenFiles: Map<string, string> = new Map();
    private readonly logger: (message: string) => void;
    private skippedSelfRedirects = 0;
    private pageConflicts = 0;
    public readonly pageJsonMap: PageJsonMapEntry[] = [];

    private readonly options: WikiPageGeneratorOptions;

    constructor(options: WikiPageGeneratorOptions) {
        this.outputRoot = options.outputRoot || './output_page';
        this.spellsDir = path.join(this.outputRoot, '法术');
        this.itemsDir = path.join(this.outputRoot, '物品');
        this.bestiaryDir = path.join(this.outputRoot, '怪物');
        this.classesDir = path.join(this.outputRoot, '职业');
        this.racesDir = path.join(this.outputRoot, '种族');
        this.featsDir = path.join(this.outputRoot, '专长');
        this.backgroundsDir = path.join(this.outputRoot, '背景');
        this.hazardsDir = path.join(this.outputRoot, '危害');
        this.trapsDir = path.join(this.outputRoot, '陷阱');
        this.bastionsDir = path.join(this.outputRoot, '据点');
        this.boonsDir = path.join(this.outputRoot, '恩赐');
        this.charoptionsDir = path.join(this.outputRoot, '角色创建选项');
        this.conditionsDir = path.join(this.outputRoot, '状态');
        this.decksDir = path.join(this.outputRoot, '牌组');
        this.deitiesDir = path.join(this.outputRoot, '神祇');
        this.objectsDir = path.join(this.outputRoot, '物件');
        this.optionalfeaturesDir = path.join(this.outputRoot, '可选特性');
        this.rewardsDir = path.join(this.outputRoot, '奖励');
        this.variantrulesDir = path.join(this.outputRoot, '变体规则');
        this.vehiclesDir = path.join(this.outputRoot, '载具');
        this.spells = options.spells;
        this.logger = options.logger || (() => {});
        this.options = options;

        this.buildItemIndex(options.baseItems, options.items, options.magicVariants);
        this.buildBestiaryIndex(options.bestiary);
        this.buildClassIndex(options.classes);
        this.buildRaceIndex(options.races);
        this.buildFeatIndex(options.feats);
        this.buildBackgroundIndex(options.backgrounds);
        this.buildHazardIndex(options.hazards);
        this.buildTrapIndex(options.traps);
        this.buildBastionIndex(options.bastions);
        this.buildBoonIndex(options.boons);
        this.buildCharoptionIndex(options.charoptions);
        this.buildConditionIndex(options.conditions);
        this.buildDeckIndex(options.decks);
        this.buildDeityIndex(options.deities);
        this.buildObjectIndex(options.objects);
        this.buildOptionalfeatureIndex(options.optionalfeatures);
        this.buildRewardIndex(options.rewards);
        this.buildVariantruleIndex(options.variantrules);
        this.buildVehicleIndex(options.vehicles);
    }

    private buildClassIndex(classes: Map<string, WikiClassData>) {
        for (const [id, classData] of classes) {
            this.classIndex.set(id, classData);
        }
    }

    private buildRaceIndex(races: Map<string, WikiRaceData>) {
        for (const [id, raceData] of races) {
            this.raceIndex.set(id, raceData);
        }
    }

    private buildFeatIndex(feats: Map<string, any>) {
        for (const [id, featData] of feats) {
            this.featIndex.set(id, featData);
        }
    }

    private buildBackgroundIndex(backgrounds: Map<string, any>) {
        for (const [id, data] of backgrounds) {
            this.backgroundIndex.set(id, data);
        }
    }

    private buildHazardIndex(hazards: Map<string, any>) {
        for (const [id, data] of hazards) {
            this.hazardIndex.set(id, data);
        }
    }

    private buildTrapIndex(traps: Map<string, any>) {
        for (const [id, data] of traps) {
            this.trapIndex.set(id, data);
        }
    }

    private buildBastionIndex(bastions: Map<string, any>) {
        for (const [id, data] of bastions) {
            this.bastionIndex.set(id, data);
        }
    }

    private buildBoonIndex(boons: Map<string, any>) {
        for (const [id, data] of boons) {
            this.boonIndex.set(id, data);
        }
    }

    private buildCharoptionIndex(charoptions: Map<string, any>) {
        for (const [id, data] of charoptions) {
            this.charoptionIndex.set(id, data);
        }
    }

    private buildConditionIndex(conditions: Map<string, any>) {
        for (const [id, data] of conditions) {
            this.conditionIndex.set(id, data);
        }
    }

    private buildDeckIndex(decks: Map<string, any>) {
        for (const [id, data] of decks) {
            this.deckIndex.set(id, data);
        }
    }

    private buildDeityIndex(deities: Map<string, any>) {
        for (const [id, data] of deities) {
            this.deityIndex.set(id, data);
        }
    }

    private buildObjectIndex(objects: Map<string, any>) {
        for (const [id, data] of objects) {
            this.objectIndex.set(id, data);
        }
    }

    private buildOptionalfeatureIndex(optionalfeatures: Map<string, any>) {
        for (const [id, data] of optionalfeatures) {
            this.optionalfeatureIndex.set(id, data);
        }
    }

    private buildRewardIndex(rewards: Map<string, any>) {
        for (const [id, data] of rewards) {
            this.rewardIndex.set(id, data);
        }
    }

    private buildVariantruleIndex(variantrules: Map<string, any>) {
        for (const [id, data] of variantrules) {
            this.variantruleIndex.set(id, data);
        }
    }

    private buildVehicleIndex(vehicles: Map<string, any>) {
        for (const [id, data] of vehicles) {
            this.vehicleIndex.set(id, data);
        }
    }

    async generateAll(): Promise<WikiPageGenerationResult> {
        await fs.mkdir(this.spellsDir, { recursive: true });
        await fs.mkdir(this.itemsDir, { recursive: true });
        await fs.mkdir(this.bestiaryDir, { recursive: true });
        await fs.mkdir(this.classesDir, { recursive: true });
        await fs.mkdir(this.racesDir, { recursive: true });
        await fs.mkdir(this.featsDir, { recursive: true });
        await fs.mkdir(this.backgroundsDir, { recursive: true });
        await fs.mkdir(this.hazardsDir, { recursive: true });
        await fs.mkdir(this.trapsDir, { recursive: true });
        await fs.mkdir(this.bastionsDir, { recursive: true });
        await fs.mkdir(this.boonsDir, { recursive: true });
        await fs.mkdir(this.charoptionsDir, { recursive: true });
        await fs.mkdir(this.conditionsDir, { recursive: true });
        await fs.mkdir(this.decksDir, { recursive: true });
        await fs.mkdir(this.deitiesDir, { recursive: true });
        await fs.mkdir(this.objectsDir, { recursive: true });
        await fs.mkdir(this.optionalfeaturesDir, { recursive: true });
        await fs.mkdir(this.rewardsDir, { recursive: true });
        await fs.mkdir(this.variantrulesDir, { recursive: true });
        await fs.mkdir(this.vehiclesDir, { recursive: true });

        await this.buildSourceNameIndex(this.options.books);

        const spellFiles = await this.generateSpellPages();
        const itemFiles = await this.generateItemPages();
        const bestiaryFiles = await this.generateBestiaryPages();
        const classFiles = await this.generateClassPages();
        const raceFiles = await this.generateRacePages();
        const featFiles = await this.generateFeatPages();
        const backgroundFiles = await this.generateBackgroundPages();
        const hazardFiles = await this.generateHazardPages();
        const trapFiles = await this.generateTrapPages();
        const bastionFiles = await this.generateBastionPages();
        const boonFiles = await this.generateBoonPages();
        const charoptionFiles = await this.generateCharoptionPages();
        const conditionFiles = await this.generateConditionPages();
        const deckFiles = await this.generateDeckPages();
        const deityFiles = await this.generateDeityPages();
        const objectFiles = await this.generateObjectPages();
        const optionalfeatureFiles = await this.generateOptionalfeaturePages();
        const rewardFiles = await this.generateRewardPages();
        const variantruleFiles = await this.generateVariantrulePages();
        const vehicleFiles = await this.generateVehiclePages();

        return {
            spellFiles,
            itemFiles,
            bestiaryFiles,
            classFiles,
            raceFiles,
            featFiles,
            backgroundFiles,
            hazardFiles,
            trapFiles,
            bastionFiles,
            boonFiles,
            charoptionFiles,
            conditionFiles,
            deckFiles,
            deityFiles,
            objectFiles,
            optionalfeatureFiles,
            rewardFiles,
            variantruleFiles,
            vehicleFiles,
            failed: 0,
            skippedSelfRedirects: this.skippedSelfRedirects,
            pageConflicts: this.pageConflicts,
        };
    }

    private async loadConfigContentsNames(): Promise<Map<string, SourceNameEntry>> {
        const names = new Map<string, SourceNameEntry>();
        try {
            const files = await fs.readdir(CONFIG_CONTENTS_DIR);
            for (const file of files) {
                if (path.extname(file).toLowerCase() === '.json') {
                    const bookId = path.basename(file, '.json');
                    const filePath = path.join(CONFIG_CONTENTS_DIR, file);
                    try {
                        let content = await fs.readFile(filePath, 'utf-8');
                        if (content.charCodeAt(0) === 0xFEFF) {
                            content = content.slice(1);
                        }
                        const data = JSON.parse(content);
                        if (data.displayName) {
                            names.set(bookId, {
                                zh: data.displayName.zh || '',
                                en: data.displayName.en || '',
                            });
                        }
                    } catch (err) {
                        console.warn(`[WikiPageGenerator] 读取 ${file} 失败:`, err);
                    }
                }
            }
        } catch (err) {
            console.warn('[WikiPageGenerator] 读取 config/contents 目录失败:', err);
        }
        return names;
    }

    private async buildSourceNameIndex(books: { en: BookFile; zh: BookFile }) {
        const configNames = await this.loadConfigContentsNames();
        
        const zhByKey = new Map<string, string>();
        for (const book of books.zh.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            for (const key of keys) {
                zhByKey.set(key, book.name);
            }
        }

        for (const book of books.en.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            const configName = configNames.get(book.id);
            const zhName = configName?.zh || zhByKey.get(book.id) || zhByKey.get(book.source);
            const enName = configName?.en || book.name;
            const existing: SourceNameEntry = {
                zh: zhName,
                en: enName,
            };
            for (const key of keys) {
                this.sourceNames.set(key, existing);
            }
        }

        for (const book of books.zh.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            const configName = configNames.get(book.id);
            for (const key of keys) {
                const existing = this.sourceNames.get(key) || {};
                this.sourceNames.set(key, {
                    zh: configName?.zh || existing.zh || book.name,
                    en: configName?.en || existing.en || book.ENG_name,
                });
            }
        }
    }

    private buildItemIndex(
        baseItems: Map<string, WikiItemData>,
        items: Map<string, WikiItemData>,
        magicVariants: Map<string, WikiItemData>
    ) {
        const append = (collection: Map<string, WikiItemData>, label: string) => {
            for (const [id, item] of collection) {
                if (this.itemIndex.has(id)) {
                    this.logger(`物品索引覆盖：${label} -> ${id}`);
                }
                this.itemIndex.set(id, item);
            }
        };

        append(baseItems, 'baseItem');
        append(items, 'item');
        append(magicVariants, 'magicVariant');
    }

    private buildBestiaryIndex(bestiary: Map<string, WikiBestiaryData>) {
        for (const [id, monster] of bestiary) {
            if (this.bestiaryIndex.has(id)) {
                this.logger(`怪物索引覆盖：${id}`);
            }
            this.bestiaryIndex.set(id, monster);
        }
    }

    private resolveSourceName(sourceId: string): string {
        const resolved = this.sourceNames.get(sourceId);
        return resolved?.zh || resolved?.en || sourceId;
    }

    private sanitizeFileSegment(value: string): string {
        return value.replace(/[\\/:*?"<>|]/g, '_').trim();
    }

    private extractNameFromId(id: string): string {
        return String(id || '')
            .split('|')[0]
            .trim();
    }

    private getRawNameZh(data: { displayName?: { zh?: string | null; en?: string | null }; id: string }): string {
        const zhName = data.displayName?.zh?.trim();
        if (zhName) return zhName;
        const enName = data.displayName?.en?.trim();
        if (enName) return enName;
        return this.extractNameFromId(data.id);
    }

    private getRawNameEn(data: { displayName?: { zh?: string | null; en?: string | null }; id: string }): string {
        const enName = data.displayName?.en?.trim();
        if (enName) return enName;
        return this.extractNameFromId(data.id) || this.getRawNameZh(data);
    }

    private buildSpellTitle(sourcePart: string, namePart: string): string {
        return `${this.sanitizeFileSegment(namePart)}`;
    }

    private buildItemTitle(sourcePart: string, namePart: string): string {
        return `${this.sanitizeFileSegment(namePart)}`;
    }

    private buildMonsterTitle(sourcePart: string, namePart: string): string {
        return `${this.sanitizeFileSegment(namePart)}`;
    }

    private toWikiTitle(fileTitle: string): string {
        return fileTitle.replace(/_9_/g, '/');
    }

    private getBaseName(displayName: string | undefined, id: string): string {
        return escapeFileName(getMwTitle(displayName || id));
    }

    private computeJsonPath(dataType: string, sourceId: string, displayNameEn: string | null | undefined, displayNameZh: string | null | undefined, id: string): string {
        const baseName = this.getBaseName(displayNameEn ?? undefined, id) || this.getBaseName(displayNameZh ?? undefined, id);
        return `${dataType}/${sourceId}/${baseName}.json`;
    }

    private computeClassJsonPath(className: string, sourceId: string, displayNameEn: string | null | undefined, displayNameZh: string | null | undefined, id: string): string {
        const lowerClassName = (className || 'other').toLowerCase();
        const baseName = this.getBaseName(displayNameEn ?? undefined, id) || this.getBaseName(displayNameZh ?? undefined, id);
        return `class/${lowerClassName}/${sourceId}/${baseName}.json`;
    }

    private computeRaceJsonPath(raceName: string, sourceId: string, id: string): string {
        const lowerRaceName = (raceName || 'other').toLowerCase();
        const idName = id.split('|')[0];
        const baseName = escapeFileName(getMwTitle(idName));
        return `race/${lowerRaceName}/${sourceId}/${baseName}.json`;
    }

    private recordPageMap(wikiFilePath: string, jsonPath: string, sourceId: string, pageId: string, locale: 'zh' | 'en'): void {
        const normalizedOutputRoot = path.normalize(this.outputRoot);
        let relativeWikiPath = path.normalize(wikiFilePath).replace(normalizedOutputRoot + path.sep, '');
        relativeWikiPath = relativeWikiPath.replace(/\\/g, '/');
        this.pageJsonMap.push({
            wikiPath: relativeWikiPath,
            jsonPath,
            bookId: sourceId,
            pageId,
            locale,
        });
    }

    private normalizeItemHierarchy(item: WikiItemData): HierarchyInfo {
        const superiorfork = item.superiorfork;
        return {
            fork:
                typeof superiorfork?.fork === 'number'
                    ? superiorfork.fork
                    : typeof item.fork === 'number'
                      ? item.fork
                      : 0,
            originId:
                typeof superiorfork?.origin === 'string'
                    ? superiorfork.origin
                    : typeof item.origin === 'string'
                      ? item.origin
                      : undefined,
            superiorId:
                typeof superiorfork?.superior === 'string'
                    ? superiorfork.superior
                    : typeof item.superior === 'string'
                      ? item.superior
                      : undefined,
            inheritsreq: superiorfork?.inheritsreq === true,
        };
    }

    private resolveTopItem(item: WikiItemData): WikiItemData {
        const hierarchy = this.normalizeItemHierarchy(item);
        if (!hierarchy.superiorId) return item;
        return this.itemIndex.get(hierarchy.superiorId) || item;
    }

    private resolveOriginItem(item: WikiItemData): WikiItemData {
        const hierarchy = this.normalizeItemHierarchy(item);
        if (!hierarchy.originId) return item;
        return this.itemIndex.get(hierarchy.originId) || item;
    }

    private async writePage(
        dir: string,
        title: string,
        content: string,
        sourceDir?: string,
        mapInfo?: { jsonPath: string; sourceId: string; pageId: string; locale: 'zh' | 'en' }
    ): Promise<boolean> {
        let targetDir = dir;
        if (sourceDir) {
            const escapedSourceDir = escapeFileName(sourceDir);
            targetDir = path.join(dir, escapedSourceDir);
            await fs.mkdir(targetDir, { recursive: true });
        }
        const filePath = path.join(targetDir, `${title}.wiki`);
        const normalizedContent = `${content}\n`;
        const existing = this.writtenFiles.get(filePath);

        if (existing !== undefined) {
            if (existing !== normalizedContent) {
                this.pageConflicts += 1;
                this.logger(`页面标题冲突，保留首个文件：${filePath}`);
            }
            return false;
        }

        await fs.writeFile(filePath, normalizedContent, 'utf-8');
        this.writtenFiles.set(filePath, normalizedContent);
        if (mapInfo && !content.startsWith('#重定向')) {
            this.recordPageMap(filePath, mapInfo.jsonPath, mapInfo.sourceId, mapInfo.pageId, mapInfo.locale);
        }
        return true;
    }

    private async writeRedirectPage(
        dir: string,
        title: string,
        targetTitle: string,
        sourceDir?: string,
        mapInfo?: { jsonPath: string; sourceId: string; pageId: string; locale: 'zh' | 'en' }
    ): Promise<boolean> {
        if (title === targetTitle) {
            this.skippedSelfRedirects += 1;
            return false;
        }
        return this.writePage(dir, title, `#重定向 [[${targetTitle}]]`, sourceDir, mapInfo);
    }

    private async generateSpellPages(): Promise<number> {
        let written = 0;

        for (const [id, spell] of this.spells) {
            const sourceId = spell.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(spell);
            const nameEn = this.getRawNameEn(spell);
            const mainTitle = this.buildSpellTitle(sourceTranslated, nameZh);
            const mainContent = `{{法术卡|${nameZh}|${sourceId}}}`;
            const jsonPath = this.computeJsonPath('spell', sourceId, spell.displayName?.en, spell.displayName?.zh, id);

            // 在中文来源文件夹写主文件
            if (await this.writePage(this.spellsDir, mainTitle, mainContent, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                written += 1;
            }

            // 在id来源文件夹写重定向
            const zhRedirectTitle = this.buildSpellTitle(sourceId, nameZh);
            const enRedirectTitle = this.buildSpellTitle(sourceId, nameEn);
            const targetWikiTitle = `法术/${sourceTranslated}/${mainTitle}`;

            if (await this.writeRedirectPage(this.spellsDir, zhRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                written += 1;
            }
            if (await this.writeRedirectPage(this.spellsDir, enRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                written += 1;
            }
        }

        return written;
    }

    private async buildItemRedirectMap(): Promise<Map<string, string>> {
        const redirectMap = new Map<string, string>();
        const pathToIdMap = new Map<string, string>(); // path -> id，用于快速查找
        
        // 先建立 path -> id 的映射
        for (const [id, item] of this.itemIndex) {
            const itemSource = this.resolveSourceName(item.mainSource.source);
            const itemTitle = this.buildItemTitle(itemSource, this.getRawNameZh(item));
            const itemPath = `物品/${itemSource}/${itemTitle}`;
            pathToIdMap.set(itemPath, id);
        }
        
        // 第一次扫描：建立基础重定向关系
        for (const [id, item] of this.itemIndex) {
            const hierarchy = this.normalizeItemHierarchy(item);
            
            if (hierarchy.fork !== 0 && hierarchy.superiorId) {
                const topItem = this.resolveTopItem(item);
                const topSourceId = topItem.mainSource.source;
                const topSourceTranslated = this.resolveSourceName(topSourceId);
                const topNameZh = this.getRawNameZh(topItem);
                const topTitle = this.buildItemTitle(topSourceTranslated, topNameZh);
                
                let finalTarget: string;
                if (hierarchy.inheritsreq) {
                    const originItem = this.resolveOriginItem(item);
                    const originNameZh = this.getRawNameZh(originItem);
                    finalTarget = `物品/${topSourceTranslated}/${topTitle}#${originNameZh}`;
                } else {
                    finalTarget = `物品/${topSourceTranslated}/${topTitle}#${this.getRawNameZh(item)}`;
                }
                
                redirectMap.set(id, finalTarget);
            }
        }
        
        // 第二次扫描：解析连锁重定向（优化版，使用 pathToIdMap 快速查找）
        for (const [id, target] of redirectMap) {
            const targetPath = target.split('#')[0];
            const anchor = target.split('#')[1];
            
            let currentPath = targetPath;
            let currentAnchor = anchor;
            let visited = new Set<string>();
            
            // 递归解析直到找到非重定向目标
            while (pathToIdMap.has(currentPath)) {
                const targetId = pathToIdMap.get(currentPath)!;
                if (!redirectMap.has(targetId)) {
                    break; // 找到非重定向目标
                }
                if (visited.has(targetId)) {
                    break; // 防止循环引用
                }
                visited.add(targetId);
                
                const nextTarget = redirectMap.get(targetId)!;
                currentPath = nextTarget.split('#')[0];
                const nextAnchor = nextTarget.split('#')[1];
                if (!currentAnchor) {
                    currentAnchor = nextAnchor; // 只在没有锚点时才继承，原有的锚点优先
                }
            }
            
            // 更新为最终目标
            const finalPath = currentPath;
            const newTarget = currentAnchor ? `${finalPath}#${currentAnchor}` : finalPath;
            if (newTarget !== target) {
                redirectMap.set(id, newTarget);
            }
        }
        
        return redirectMap;
    }

    private async generateItemPages(): Promise<number> {
        let written = 0;
        const redirectMap = await this.buildItemRedirectMap();

        for (const [id, item] of this.itemIndex) {
            const sourceId = item.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(item);
            const nameEn = this.getRawNameEn(item);
            const hierarchy = this.normalizeItemHierarchy(item);
            const jsonPath = this.computeJsonPath('item', sourceId, item.displayName?.en, item.displayName?.zh, id);

            // 判断是否是真正的顶级条目（不重定向到其他页面）
            const isTrueTopLevel = hierarchy.fork === 0 || !hierarchy.superiorId;

            if (isTrueTopLevel) {
                // 真正的顶级条目：在中文来源文件夹写模板内容
                const mainTitle = this.buildItemTitle(sourceTranslated, nameZh);
                const mainContent = `{{物品卡|${nameZh}|${sourceId}}}`;

                if (await this.writePage(this.itemsDir, mainTitle, mainContent, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }

                // 同时在 id 来源文件夹也写重定向到中文来源的模板页面
                const zhRedirectTitle = this.buildItemTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildItemTitle(sourceId, nameEn);
                const targetWikiTitle = `物品/${sourceTranslated}/${mainTitle}`;

                if (await this.writeRedirectPage(this.itemsDir, zhRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.itemsDir, enRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                    written += 1;
                }
            } else {
                // 非顶级条目：直接使用最终重定向目标
                const finalTarget = redirectMap.get(id) || '';

                // 在中文来源文件夹直接写重定向到最终模板
                const mainTitle = this.buildItemTitle(sourceTranslated, nameZh);
                if (await this.writeRedirectPage(this.itemsDir, mainTitle, finalTarget, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }

                // 在 id 来源文件夹也直接写重定向到最终模板
                const zhRedirectTitle = this.buildItemTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildItemTitle(sourceId, nameEn);

                if (await this.writeRedirectPage(this.itemsDir, zhRedirectTitle, finalTarget, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.itemsDir, enRedirectTitle, finalTarget, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                    written += 1;
                }
            }
        }

        return written;
    }

    private normalizeMonsterHierarchy(monster: WikiBestiaryData): HierarchyInfo {
        const superiorfork = monster.superiorfork;
        return {
            fork:
                typeof superiorfork?.fork === 'number'
                    ? superiorfork.fork
                    : typeof monster.fork === 'number'
                      ? monster.fork
                      : 0,
            originId:
                typeof superiorfork?.origin === 'string'
                    ? superiorfork.origin
                    : typeof monster.origin === 'string'
                      ? monster.origin
                      : undefined,
            superiorId:
                typeof superiorfork?.superior === 'string'
                    ? superiorfork.superior
                    : typeof monster.superior === 'string'
                      ? monster.superior
                      : undefined,
            inheritsreq: superiorfork?.inheritsreq === true,
        };
    }

    private resolveTopMonster(monster: WikiBestiaryData): WikiBestiaryData {
        const hierarchy = this.normalizeMonsterHierarchy(monster);
        let currentId: string | undefined = hierarchy.superiorId;
        let topMonster: WikiBestiaryData = monster;
        let lastNavpillMonster: WikiBestiaryData | undefined = undefined;
        
        if ((monster as any).isnavpill) {
            lastNavpillMonster = monster;
        }
        
        if (hierarchy.originId) {
            let originId: string | undefined = hierarchy.originId;
            while (originId) {
                const originMonster = this.bestiaryIndex.get(originId);
                if (originMonster) {
                    if ((originMonster as any).isnavpill) {
                        lastNavpillMonster = originMonster;
                        break;
                    }
                    const originHierarchy = this.normalizeMonsterHierarchy(originMonster);
                    originId = originHierarchy.originId;
                } else {
                    break;
                }
            }
        }
        
        if (!lastNavpillMonster) {
            while (currentId) {
                const current = this.bestiaryIndex.get(currentId);
                if (current) {
                    topMonster = current;
                    if ((current as any).isnavpill) {
                        lastNavpillMonster = current;
                        break;
                    }
                    currentId = this.normalizeMonsterHierarchy(current).superiorId;
                } else {
                    break;
                }
            }
        }
        
        return lastNavpillMonster || topMonster;
    }

    private resolveOriginMonster(monster: WikiBestiaryData): WikiBestiaryData {
        const hierarchy = this.normalizeMonsterHierarchy(monster);
        if (!hierarchy.originId) return monster;
        return this.bestiaryIndex.get(hierarchy.originId) || monster;
    }

    private async buildBestiaryRedirectMap(): Promise<Map<string, string>> {
        const redirectMap = new Map<string, string>();
        const pathToIdMap = new Map<string, string>(); // path -> id，用于快速查找
        
        // 先建立 path -> id 的映射
        for (const [id, monster] of this.bestiaryIndex) {
            const monsterSource = this.resolveSourceName(monster.mainSource.source);
            const monsterTitle = this.buildMonsterTitle(monsterSource, this.getRawNameZh(monster));
            const monsterPath = `怪物/${monsterSource}/${monsterTitle}`;
            pathToIdMap.set(monsterPath, id);
        }
        
        // 第一次扫描：建立基础重定向关系
        for (const [id, monster] of this.bestiaryIndex) {
            const hierarchy = this.normalizeMonsterHierarchy(monster);
            const anyMonster = monster as any;
            const nameZh = this.getRawNameZh(monster);
            
            // 先处理特殊的强制重定向逻辑
            if (nameZh.includes('红龙') && nameZh !== '红龙' && !anyMonster.isnavpill) {
                // 强制重定向到红龙！
                redirectMap.set(id, `怪物/怪物手册（2014）/红龙#${nameZh}`);
            } 
            // 正常逻辑：判断是否需要重定向
            else if (!anyMonster.isnavpill && hierarchy.fork !== 0 && hierarchy.superiorId) {
                const topMonster = this.resolveTopMonster(monster);
                const topSourceId = topMonster.mainSource.source;
                const topSourceTranslated = this.resolveSourceName(topSourceId);
                const topNameZh = this.getRawNameZh(topMonster);
                const topTitle = this.buildMonsterTitle(topSourceTranslated, topNameZh);
                
                // 构建最终的重定向目标（直接指向顶级模板页面）
                if (hierarchy.inheritsreq) {
                    const originMonster = this.resolveOriginMonster(monster);
                    const originNameZh = this.getRawNameZh(originMonster);
                    redirectMap.set(id, `怪物/${topSourceTranslated}/${topTitle}#${originNameZh}`);
                } else {
                    redirectMap.set(id, `怪物/${topSourceTranslated}/${topTitle}#${nameZh}`);
                }
            }
        }
        
        // 第二次扫描：解析连锁重定向（优化版，使用 pathToIdMap 快速查找）
        for (const [id, target] of redirectMap) {
            const targetPath = target.split('#')[0];
            const anchor = target.split('#')[1];
            
            let currentPath = targetPath;
            let currentAnchor = anchor;
            let visited = new Set<string>();
            
            // 递归解析直到找到非重定向目标
            while (pathToIdMap.has(currentPath)) {
                const targetId = pathToIdMap.get(currentPath)!;
                if (!redirectMap.has(targetId)) {
                    break; // 找到非重定向目标
                }
                if (visited.has(targetId)) {
                    break; // 防止循环引用
                }
                visited.add(targetId);
                
                const nextTarget = redirectMap.get(targetId)!;
                currentPath = nextTarget.split('#')[0];
                const nextAnchor = nextTarget.split('#')[1];
                if (!currentAnchor) {
                    currentAnchor = nextAnchor; // 只在没有锚点时才继承，原有的锚点优先
                }
            }
            
            // 更新为最终目标
            const finalPath = currentPath;
            const newTarget = currentAnchor ? `${finalPath}#${currentAnchor}` : finalPath;
            if (newTarget !== target) {
                redirectMap.set(id, newTarget);
            }
        }
        
        return redirectMap;
    }

    private async generateBestiaryPages(): Promise<number> {
        let written = 0;
        const redirectMap = await this.buildBestiaryRedirectMap();

        for (const [id, monster] of this.bestiaryIndex) {
            const sourceId = monster.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(monster);
            const nameEn = this.getRawNameEn(monster);
            const hierarchy = this.normalizeMonsterHierarchy(monster);
            const anyMonster = monster as any;
            const jsonPath = this.computeJsonPath('bestiary', sourceId, monster.displayName?.en, monster.displayName?.zh, id);

            // 判断是否是真正的顶级条目（不在重定向表中）
            const isTrueTopLevel = !redirectMap.has(id);

            if (isTrueTopLevel) {
                // 真正的顶级条目：在中文来源文件夹写模板内容
                const mainTitle = this.buildMonsterTitle(sourceTranslated, nameZh);
                const mainContent = `{{怪物卡|${nameZh}|${sourceId}}}`;

                if (await this.writePage(this.bestiaryDir, mainTitle, mainContent, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }

                // 同时在 id 来源文件夹也写重定向到中文来源的模板页面
                const zhRedirectTitle = this.buildMonsterTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildMonsterTitle(sourceId, nameEn);
                const targetWikiTitle = `怪物/${sourceTranslated}/${mainTitle}`;

                if (await this.writeRedirectPage(this.bestiaryDir, zhRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.bestiaryDir, enRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                    written += 1;
                }
            } else {
                // 非顶级条目：直接使用重定向表中的最终目标
                const finalTarget = redirectMap.get(id) || '';

                // 在中文来源文件夹直接写重定向到最终模板
                const mainTitle = this.buildMonsterTitle(sourceTranslated, nameZh);
                if (await this.writeRedirectPage(this.bestiaryDir, mainTitle, finalTarget, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }

                // 在 id 来源文件夹也直接写重定向到最终模板
                const zhRedirectTitle = this.buildMonsterTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildMonsterTitle(sourceId, nameEn);

                if (await this.writeRedirectPage(this.bestiaryDir, zhRedirectTitle, finalTarget, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.bestiaryDir, enRedirectTitle, finalTarget, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                    written += 1;
                }
            }
        }

        return written;
    }

    private async generateClassPages(): Promise<number> {
        let written = 0;

        // 首先收集所有主职业的信息，用于子职业生成重定向时查找
        const mainClassMap = new Map<string, { zhName: string; enName: string; source: string; rulesVersion: string }>();

        // 第一遍：处理主职业，收集信息
        for (const [id, classData] of this.classIndex) {
            const fork = classData.superiorfork?.fork ?? 0;
            if (fork !== 0) continue; // 只处理主职业

            const rulesVersion = classData.basicRules2024 ? '2024' : '2014';
            const source = classData.mainSource.source;
            const zhName = classData.displayName?.zh?.trim() || classData.zh?.name?.trim() || '';
            const enName = classData.displayName?.en?.trim() || classData.en?.name?.trim() || '';

            if (zhName || enName) {
                mainClassMap.set(id, { zhName, enName, source, rulesVersion });
            }
        }

        // 第二遍：生成所有职业页面
        for (const [id, classData] of this.classIndex) {
            const fork = classData.superiorfork?.fork ?? 0;
            const isMainClass = fork === 0;
            const rulesVersion = classData.basicRules2024 ? '2024' : '2014';
            const source = classData.mainSource.source;
            const zhName = classData.displayName?.zh?.trim() || classData.zh?.name?.trim() || '';
            const enName = classData.displayName?.en?.trim() || classData.en?.name?.trim() || '';
            const classNameForPath = enName || id.split('|')[0] || 'other';
            const jsonPath = this.computeClassJsonPath(classNameForPath, source, classData.displayName?.en, classData.displayName?.zh, id);

            if (!zhName && !enName) continue;

            if (isMainClass) {
                // 主职业：生成内容页面
                const contentDir = path.join(this.classesDir, rulesVersion);
                await fs.mkdir(contentDir, { recursive: true });

                // 中文版本
                if (zhName) {
                    const zhFilePath = path.join(contentDir, `${zhName}.wiki`);
                    const zhContent = `{{职业卡|${zhName}|${source}|zh}}`;
                    if (await this.writeClassPage(zhFilePath, zhContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                        written++;
                    }
                }

                // 英文版本（内容使用英文参数）
                if (enName && enName !== zhName) {
                    const enFilePath = path.join(contentDir, `${enName}.wiki`);
                    const enContent = `{{职业卡|${enName}|${source}|en}}`;
                    if (await this.writeClassPage(enFilePath, enContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                        written++;
                    }
                }

                // 生成重定向页面
                const redirectDir = path.join(this.classesDir, this.sanitizeFileSegment(source));
                await fs.mkdir(redirectDir, { recursive: true });

                // 中文名称重定向：指向中文内容页面
                if (zhName) {
                    const zhContentPagePath = `职业/${rulesVersion}/${zhName}`;
                    const zhRedirectPath = path.join(redirectDir, `${zhName}.wiki`);
                    const zhRedirectContent = `#重定向 [[${zhContentPagePath}]]`;
                    if (await this.writeClassPage(zhRedirectPath, zhRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                        written++;
                    }
                }

                // 英文名称重定向：指向英文内容页面
                if (enName && enName !== zhName) {
                    const enContentPagePath = `职业/${rulesVersion}/${enName}`;
                    const enRedirectPath = path.join(redirectDir, `${enName}.wiki`);
                    const enRedirectContent = `#重定向 [[${enContentPagePath}]]`;
                    if (await this.writeClassPage(enRedirectPath, enRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                        written++;
                    }
                }
            } else {
                // 子职业：生成重定向页面
                const superiorId = classData.superiorfork?.superior;
                if (!superiorId) continue;

                const mainClassInfo = mainClassMap.get(superiorId);
                if (!mainClassInfo) continue;

                const mainRulesVersion = mainClassInfo.rulesVersion;

                // 生成重定向页面
                const redirectDir = path.join(this.classesDir, this.sanitizeFileSegment(source));
                await fs.mkdir(redirectDir, { recursive: true });

                // 中文名称重定向：指向中文主职业页面的锚点
                if (zhName) {
                    const mainZhName = mainClassInfo.zhName;
                    if (mainZhName) {
                        const zhRedirectTarget = `职业/${mainRulesVersion}/${mainZhName}#${zhName}`;
                        const zhRedirectPath = path.join(redirectDir, `${zhName}.wiki`);
                        const zhRedirectContent = `#重定向 [[${zhRedirectTarget}]]`;
                        if (await this.writeClassPage(zhRedirectPath, zhRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                            written++;
                        }
                    }
                }

                // 英文名称重定向：指向英文主职业页面的锚点
                if (enName && enName !== zhName) {
                    const mainEnName = mainClassInfo.enName;
                    if (mainEnName) {
                        const enRedirectTarget = `职业/${mainRulesVersion}/${mainEnName}#${enName}`;
                        const enRedirectPath = path.join(redirectDir, `${enName}.wiki`);
                        const enRedirectContent = `#重定向 [[${enRedirectTarget}]]`;
                        if (await this.writeClassPage(enRedirectPath, enRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                            written++;
                        }
                    }
                }
            }
        }

        return written;
    }

    private async writeClassPage(filePath: string, content: string, mapInfo?: { jsonPath: string; sourceId: string; pageId: string; locale: 'zh' | 'en' }): Promise<boolean> {
        const normalizedContent = `${content}\n`;
        const existing = this.writtenFiles.get(filePath);

        if (existing !== undefined) {
            if (existing !== normalizedContent) {
                this.pageConflicts += 1;
                this.logger(`页面冲突，保留首个文件：${filePath}`);
            }
            return false;
        }

        // 确保目录存在（处理名称中可能包含 / 的情况）
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, normalizedContent, 'utf-8');
        this.writtenFiles.set(filePath, normalizedContent);
        if (mapInfo && !content.startsWith('#重定向')) {
            this.recordPageMap(filePath, mapInfo.jsonPath, mapInfo.sourceId, mapInfo.pageId, mapInfo.locale);
        }
        return true;
    }

    private async generateRacePages(): Promise<number> {
        let written = 0;

        const mainRaceMap = new Map<string, { zhName: string; enName: string; source: string }>();

        for (const [id, raceData] of this.raceIndex) {
            const fork = raceData.superiorfork?.fork ?? 0;
            if (fork !== 0) continue;

            const source = raceData.mainSource.source;
            const zhName = raceData.displayName?.zh?.trim() || '';
            const enName = raceData.displayName?.en?.trim() || '';

            if (zhName || enName) {
                mainRaceMap.set(id, { zhName, enName, source });
            }
        }

        for (const [id, raceData] of this.raceIndex) {
            const fork = raceData.superiorfork?.fork ?? 0;
            const isMainRace = fork === 0;
            const source = raceData.mainSource.source;
            const zhName = raceData.displayName?.zh?.trim() || '';
            const enName = raceData.displayName?.en?.trim() || '';
            const raceNameForPath = enName || id.split('|')[0] || 'other';
            const jsonPath = this.computeRaceJsonPath(raceNameForPath, source, id);

            if (!zhName && !enName) continue;

            if (isMainRace) {
                const sourceTranslated = this.resolveSourceName(source);
                const sourceNameEntry = this.sourceNames.get(source);
                const sourceEnglishName = sourceNameEntry?.en || source;

                const safeSourceZhDir = this.sanitizeFileSegment(sourceTranslated);
                const zhContentDir = path.join(this.racesDir, safeSourceZhDir);
                await fs.mkdir(zhContentDir, { recursive: true });

                const mainZhTitle = zhName ? this.buildItemTitle(sourceTranslated, zhName) : (enName ? this.buildItemTitle(sourceTranslated, enName) : '');
                if (mainZhTitle) {
                    const displayNameForCard = zhName || enName;
                    const mainContent = `{{种族卡|${displayNameForCard}|${source}}}`;
                    const mainFilePath = path.join(zhContentDir, `${mainZhTitle}.wiki`);
                    if (await this.writeRacePage(mainFilePath, mainContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                        written++;
                    }
                }

                if (enName) {
                    const safeSourceEnDir = this.sanitizeFileSegment(sourceEnglishName);
                    const enContentDir = path.join(this.racesDir, safeSourceEnDir);
                    await fs.mkdir(enContentDir, { recursive: true });

                    const mainZhTitle = zhName ? this.buildItemTitle(sourceTranslated, zhName) : this.buildItemTitle(sourceTranslated, enName);
                    const targetWikiTitle = `种族/${sourceTranslated}/${mainZhTitle}`;
                    const mainEnTitle = this.buildItemTitle(sourceEnglishName, enName);
                    const mainFilePath = path.join(enContentDir, `${mainEnTitle}.wiki`);
                    const enRedirectContent = `#重定向 [[${targetWikiTitle}]]`;
                    if (await this.writeRacePage(mainFilePath, enRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                        written++;
                    }
                }

                const safeSourceIdDir = this.sanitizeFileSegment(source);
                const redirectDir = path.join(this.racesDir, safeSourceIdDir);
                await fs.mkdir(redirectDir, { recursive: true });

                if (zhName) {
                    const mainTitle = this.buildItemTitle(sourceTranslated, zhName);
                    const targetWikiTitle = `种族/${sourceTranslated}/${mainTitle}`;
                    const zhRedirectTitle = this.buildItemTitle(source, zhName);
                    const zhRedirectPath = path.join(redirectDir, `${zhRedirectTitle}.wiki`);
                    const zhRedirectContent = `#重定向 [[${targetWikiTitle}]]`;
                    if (await this.writeRacePage(zhRedirectPath, zhRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                        written++;
                    }
                }

                if (enName) {
                    const mainZhTitle = zhName ? this.buildItemTitle(sourceTranslated, zhName) : this.buildItemTitle(sourceTranslated, enName);
                    const targetWikiTitle = `种族/${sourceTranslated}/${mainZhTitle}`;
                    const enRedirectTitle = this.buildItemTitle(source, enName);
                    const enRedirectPath = path.join(redirectDir, `${enRedirectTitle}.wiki`);
                    const enRedirectContent = `#重定向 [[${targetWikiTitle}]]`;
                    if (await this.writeRacePage(enRedirectPath, enRedirectContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                        written++;
                    }
                }
            } else {
                const superiorId = raceData.superiorfork?.superior;
                if (!superiorId) continue;

                const mainRaceInfo = mainRaceMap.get(superiorId);
                if (!mainRaceInfo) continue;

                const mainSourceTranslated = this.resolveSourceName(mainRaceInfo.source);
                const sourceTranslated = this.resolveSourceName(source);

                if (zhName) {
                    const mainZhName = mainRaceInfo.zhName;
                    if (mainZhName) {
                        const mainTitle = this.buildItemTitle(mainSourceTranslated, mainZhName);
                        const zhRedirectTarget = `种族/${mainSourceTranslated}/${mainTitle}#${zhName}`;

                        const safeSourceZhDir = this.sanitizeFileSegment(sourceTranslated);
                        const zhContentDir = path.join(this.racesDir, safeSourceZhDir);
                        await fs.mkdir(zhContentDir, { recursive: true });

                        const mainZhTitle = this.buildItemTitle(sourceTranslated, zhName);
                        const zhFilePath = path.join(zhContentDir, `${mainZhTitle}.wiki`);
                        const zhContent = `#重定向 [[${zhRedirectTarget}]]`;
                        if (await this.writeRacePage(zhFilePath, zhContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                            written++;
                        }

                        const safeSourceIdDir = this.sanitizeFileSegment(source);
                        const redirectDir = path.join(this.racesDir, safeSourceIdDir);
                        await fs.mkdir(redirectDir, { recursive: true });

                        const zhRedirectTitle = this.buildItemTitle(source, zhName);
                        const zhRedirectPath = path.join(redirectDir, `${zhRedirectTitle}.wiki`);
                        if (await this.writeRacePage(zhRedirectPath, zhContent, { jsonPath, sourceId: source, pageId: id, locale: 'zh' })) {
                            written++;
                        }
                    }
                }

                if (enName && enName !== zhName) {
                    const mainEnName = mainRaceInfo.enName;
                    if (mainEnName) {
                        const mainTitle = this.buildItemTitle(mainSourceTranslated, mainEnName);
                        const enRedirectTarget = `种族/${mainSourceTranslated}/${mainTitle}#${enName}`;

                        const sourceNameEntry = this.sourceNames.get(source);
                        const sourceEnglishName = sourceNameEntry?.en || source;

                        const safeSourceEnDir = this.sanitizeFileSegment(sourceEnglishName);
                        const enContentDir = path.join(this.racesDir, safeSourceEnDir);
                        await fs.mkdir(enContentDir, { recursive: true });

                        const mainEnTitle = this.buildItemTitle(sourceEnglishName, enName);
                        const enFilePath = path.join(enContentDir, `${mainEnTitle}.wiki`);
                        const enContent = `#重定向 [[${enRedirectTarget}]]`;
                        if (await this.writeRacePage(enFilePath, enContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                            written++;
                        }

                        const safeSourceIdDir = this.sanitizeFileSegment(source);
                        const redirectDir = path.join(this.racesDir, safeSourceIdDir);
                        await fs.mkdir(redirectDir, { recursive: true });

                        const enRedirectTitle = this.buildItemTitle(source, enName);
                        const enRedirectPath = path.join(redirectDir, `${enRedirectTitle}.wiki`);
                        if (await this.writeRacePage(enRedirectPath, enContent, { jsonPath, sourceId: source, pageId: id, locale: 'en' })) {
                            written++;
                        }
                    }
                }
            }
        }

        return written;
    }

    private async writeRacePage(filePath: string, content: string, mapInfo?: { jsonPath: string; sourceId: string; pageId: string; locale: 'zh' | 'en' }): Promise<boolean> {
        const normalizedContent = `${content}\n`;
        const existing = this.writtenFiles.get(filePath);

        if (existing !== undefined) {
            if (existing !== normalizedContent) {
                this.pageConflicts += 1;
                this.logger(`页面冲突，保留首个文件：${filePath}`);
            }
            return false;
        }

        await fs.writeFile(filePath, normalizedContent, 'utf-8');
        this.writtenFiles.set(filePath, normalizedContent);
        if (mapInfo && !content.startsWith('#重定向')) {
            this.recordPageMap(filePath, mapInfo.jsonPath, mapInfo.sourceId, mapInfo.pageId, mapInfo.locale);
        }
        return true;
    }

    private async generateFeatPages(): Promise<number> {
        return this.generateGenericPages(
            this.featIndex,
            this.featsDir,
            'feat',
            '{{专长卡|{name}|{source}}}',
            '专长'
        );
    }

    private async generateGenericPages(
        index: Map<string, any>,
        dir: string,
        dataType: string,
        cardTemplate: string,
        chineseDirName: string
    ): Promise<number> {
        let written = 0;

        for (const [id, data] of index) {
            const sourceId = data.mainSource?.source;
            if (!sourceId) continue;

            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(data);
            const nameEn = this.getRawNameEn(data);
            const jsonPath = this.computeJsonPath(dataType, sourceId, data.displayName?.en, data.displayName?.zh, id);

            if (nameZh) {
                const mainTitle = this.sanitizeFileSegment(nameZh);
                const mainContent = cardTemplate.replace(/\{name\}/g, nameZh).replace(/\{source\}/g, sourceId);

                if (await this.writePage(dir, mainTitle, mainContent, sourceTranslated, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }

                const zhRedirectTitle = this.sanitizeFileSegment(nameZh);
                const targetWikiTitle = `${chineseDirName}/${sourceTranslated}/${mainTitle}`;

                if (await this.writeRedirectPage(dir, zhRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'zh' })) {
                    written += 1;
                }
            }

            if (nameEn && nameEn !== nameZh) {
                const enRedirectTitle = this.sanitizeFileSegment(nameEn);
                const mainTitle = nameZh ? this.sanitizeFileSegment(nameZh) : this.sanitizeFileSegment(nameEn);
                const targetWikiTitle = `${chineseDirName}/${sourceTranslated}/${mainTitle}`;

                if (await this.writeRedirectPage(dir, enRedirectTitle, targetWikiTitle, sourceId, { jsonPath, sourceId, pageId: id, locale: 'en' })) {
                    written += 1;
                }
            }
        }

        return written;
    }

    private async generateBackgroundPages(): Promise<number> {
        return this.generateGenericPages(this.backgroundIndex, this.backgroundsDir, 'background', '{{背景卡|{name}|{source}}}', '背景');
    }

    private async generateHazardPages(): Promise<number> {
        return this.generateGenericPages(this.hazardIndex, this.hazardsDir, 'hazard', '{{危害卡|{name}|{source}}}', '危害');
    }

    private async generateTrapPages(): Promise<number> {
        return this.generateGenericPages(this.trapIndex, this.trapsDir, 'trap', '{{陷阱卡|{name}|{source}}}', '陷阱');
    }

    private async generateBastionPages(): Promise<number> {
        return this.generateGenericPages(this.bastionIndex, this.bastionsDir, 'bastion', '{{据点卡|{name}|{source}}}', '据点');
    }

    private async generateBoonPages(): Promise<number> {
        return this.generateGenericPages(this.boonIndex, this.boonsDir, 'boon', '{{恩赐卡|{name}|{source}}}', '恩赐');
    }

    private async generateCharoptionPages(): Promise<number> {
        return this.generateGenericPages(this.charoptionIndex, this.charoptionsDir, 'charoption', '{{角色创建选项卡|{name}|{source}}}', '角色创建选项');
    }

    private async generateConditionPages(): Promise<number> {
        return this.generateGenericPages(this.conditionIndex, this.conditionsDir, 'condition', '{{状态卡|{name}|{source}}}', '状态');
    }

    private async generateDeckPages(): Promise<number> {
        return this.generateGenericPages(this.deckIndex, this.decksDir, 'deck', '{{牌组卡|{name}|{source}}}', '牌组');
    }

    private async generateDeityPages(): Promise<number> {
        return this.generateGenericPages(this.deityIndex, this.deitiesDir, 'deity', '{{神祇卡|{name}|{source}}}', '神祇');
    }

    private async generateObjectPages(): Promise<number> {
        return this.generateGenericPages(this.objectIndex, this.objectsDir, 'object', '{{物件卡|{name}|{source}}}', '物件');
    }

    private async generateOptionalfeaturePages(): Promise<number> {
        return this.generateGenericPages(this.optionalfeatureIndex, this.optionalfeaturesDir, 'optionalfeature', '{{可选特性卡|{name}|{source}}}', '可选特性');
    }

    private async generateRewardPages(): Promise<number> {
        return this.generateGenericPages(this.rewardIndex, this.rewardsDir, 'reward', '{{奖励卡|{name}|{source}}}', '奖励');
    }

    private async generateVariantrulePages(): Promise<number> {
        return this.generateGenericPages(this.variantruleIndex, this.variantrulesDir, 'variantrule', '{{变体规则卡|{name}|{source}}}', '变体规则');
    }

    private async generateVehiclePages(): Promise<number> {
        return this.generateGenericPages(this.vehicleIndex, this.vehiclesDir, 'vehicle', '{{载具卡|{name}|{source}}}', '载具');
    }
}

export type { WikiPageGenerationResult };