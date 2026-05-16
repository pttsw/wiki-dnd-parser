import { promises as fs } from 'fs';
import path from 'path';
import { BookFile } from './types/books.js';
import { WikiItemData } from './types/items.js';
import { WikiSpellData } from './types/spells.js';
import { WikiBestiaryData } from './types/bestiary.js';
import { escapeFileName } from './exporters/shared.js';

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
    outputRoot?: string;
    logger?: (message: string) => void;
};

type WikiPageGenerationResult = {
    spellFiles: number;
    itemFiles: number;
    bestiaryFiles: number;
    failed: number;
    skippedSelfRedirects: number;
    pageConflicts: number;
};

export class WikiPageGenerator {
    private readonly outputRoot: string;
    private readonly spellsDir: string;
    private readonly itemsDir: string;
    private readonly bestiaryDir: string;
    private readonly spells: Map<string, WikiSpellData>;
    private readonly itemIndex: Map<string, WikiItemData> = new Map();
    private readonly bestiaryIndex: Map<string, WikiBestiaryData> = new Map();
    private readonly sourceNames: Map<string, SourceNameEntry> = new Map();
    private readonly writtenFiles: Map<string, string> = new Map();
    private readonly logger: (message: string) => void;
    private skippedSelfRedirects = 0;
    private pageConflicts = 0;

    constructor(options: WikiPageGeneratorOptions) {
        this.outputRoot = options.outputRoot || './output_page';
        this.spellsDir = path.join(this.outputRoot, '法术');
        this.itemsDir = path.join(this.outputRoot, '物品');
        this.bestiaryDir = path.join(this.outputRoot, '怪物');
        this.spells = options.spells;
        this.logger = options.logger || (() => {});

        this.buildSourceNameIndex(options.books);
        this.buildItemIndex(options.baseItems, options.items, options.magicVariants);
        this.buildBestiaryIndex(options.bestiary);
    }

    async generateAll(): Promise<WikiPageGenerationResult> {
        await fs.mkdir(this.spellsDir, { recursive: true });
        await fs.mkdir(this.itemsDir, { recursive: true });
        await fs.mkdir(this.bestiaryDir, { recursive: true });

        const spellFiles = await this.generateSpellPages();
        const itemFiles = await this.generateItemPages();
        const bestiaryFiles = await this.generateBestiaryPages();

        return {
            spellFiles,
            itemFiles,
            bestiaryFiles,
            failed: 0,
            skippedSelfRedirects: this.skippedSelfRedirects,
            pageConflicts: this.pageConflicts,
        };
    }

    private buildSourceNameIndex(books: { en: BookFile; zh: BookFile }) {
        const zhByKey = new Map<string, string>();
        for (const book of books.zh.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            for (const key of keys) {
                zhByKey.set(key, book.name);
            }
        }

        for (const book of books.en.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            const zhName = zhByKey.get(book.id) || zhByKey.get(book.source);
            const existing: SourceNameEntry = {
                zh: zhName,
                en: book.name,
            };
            for (const key of keys) {
                this.sourceNames.set(key, existing);
            }
        }

        for (const book of books.zh.book || []) {
            const keys = new Set<string>([book.id, book.source].filter(Boolean));
            for (const key of keys) {
                const existing = this.sourceNames.get(key) || {};
                this.sourceNames.set(key, {
                    zh: existing.zh || book.name,
                    en: existing.en || book.ENG_name,
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
        return fileTitle.replace(/_1_/g, '/');
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

    private async writePage(dir: string, title: string, content: string, sourceDir?: string): Promise<boolean> {
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
        return true;
    }

    private async writeRedirectPage(
        dir: string,
        title: string,
        targetTitle: string,
        sourceDir?: string
    ): Promise<boolean> {
        if (title === targetTitle) {
            this.skippedSelfRedirects += 1;
            return false;
        }
        return this.writePage(dir, title, `#重定向 [[${targetTitle}]]`, sourceDir);
    }

    private async generateSpellPages(): Promise<number> {
        let written = 0;

        for (const [, spell] of this.spells) {
            const sourceId = spell.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(spell);
            const nameEn = this.getRawNameEn(spell);
            const mainTitle = this.buildSpellTitle(sourceTranslated, nameZh);
            const mainContent = `{{法术卡|${nameZh}|${sourceId}}}`;

            // 在中文来源文件夹写主文件
            if (await this.writePage(this.spellsDir, mainTitle, mainContent, sourceTranslated)) {
                written += 1;
            }

            // 在id来源文件夹写重定向
            const zhRedirectTitle = this.buildSpellTitle(sourceId, nameZh);
            const enRedirectTitle = this.buildSpellTitle(sourceId, nameEn);
            const targetWikiTitle = `法术/${sourceTranslated}/${mainTitle}`;
            
            if (await this.writeRedirectPage(this.spellsDir, zhRedirectTitle, targetWikiTitle, sourceId)) {
                written += 1;
            }
            if (await this.writeRedirectPage(this.spellsDir, enRedirectTitle, targetWikiTitle, sourceId)) {
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

            // 判断是否是真正的顶级条目（不重定向到其他页面）
            const isTrueTopLevel = hierarchy.fork === 0 || !hierarchy.superiorId;
            
            if (isTrueTopLevel) {
                // 真正的顶级条目：在中文来源文件夹写模板内容
                const mainTitle = this.buildItemTitle(sourceTranslated, nameZh);
                const mainContent = `{{物品卡|${nameZh}|${sourceId}}}`;
                
                if (await this.writePage(this.itemsDir, mainTitle, mainContent, sourceTranslated)) {
                    written += 1;
                }
                
                // 同时在 id 来源文件夹也写重定向到中文来源的模板页面
                const zhRedirectTitle = this.buildItemTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildItemTitle(sourceId, nameEn);
                const targetWikiTitle = `物品/${sourceTranslated}/${mainTitle}`;
                
                if (await this.writeRedirectPage(this.itemsDir, zhRedirectTitle, targetWikiTitle, sourceId)) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.itemsDir, enRedirectTitle, targetWikiTitle, sourceId)) {
                    written += 1;
                }
            } else {
                // 非顶级条目：直接使用最终重定向目标
                const finalTarget = redirectMap.get(id) || '';
                
                // 在中文来源文件夹直接写重定向到最终模板
                const mainTitle = this.buildItemTitle(sourceTranslated, nameZh);
                if (await this.writeRedirectPage(this.itemsDir, mainTitle, finalTarget, sourceTranslated)) {
                    written += 1;
                }
                
                // 在 id 来源文件夹也直接写重定向到最终模板
                const zhRedirectTitle = this.buildItemTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildItemTitle(sourceId, nameEn);
                
                if (await this.writeRedirectPage(this.itemsDir, zhRedirectTitle, finalTarget, sourceId)) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.itemsDir, enRedirectTitle, finalTarget, sourceId)) {
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
        let currentId: string | undefined = this.normalizeMonsterHierarchy(monster).superiorId;
        let topMonster: WikiBestiaryData = monster;
        let firstNavpillMonster: WikiBestiaryData | undefined = undefined;
        
        while (currentId) {
            const current = this.bestiaryIndex.get(currentId);
            if (current) {
                topMonster = current;
                if ((current as any).isnavpill && !firstNavpillMonster) {
                    firstNavpillMonster = current;
                }
                currentId = this.normalizeMonsterHierarchy(current).superiorId;
            } else {
                break;
            }
        }
        
        return firstNavpillMonster || topMonster;
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

            // 判断是否是真正的顶级条目（不在重定向表中）
            const isTrueTopLevel = !redirectMap.has(id);
            
            if (isTrueTopLevel) {
                // 真正的顶级条目：在中文来源文件夹写模板内容
                const mainTitle = this.buildMonsterTitle(sourceTranslated, nameZh);
                const mainContent = `{{怪物卡|${nameZh}|${sourceId}}}`;
                
                if (await this.writePage(this.bestiaryDir, mainTitle, mainContent, sourceTranslated)) {
                    written += 1;
                }
                
                // 同时在 id 来源文件夹也写重定向到中文来源的模板页面
                const zhRedirectTitle = this.buildMonsterTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildMonsterTitle(sourceId, nameEn);
                const targetWikiTitle = `怪物/${sourceTranslated}/${mainTitle}`;
                
                if (await this.writeRedirectPage(this.bestiaryDir, zhRedirectTitle, targetWikiTitle, sourceId)) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.bestiaryDir, enRedirectTitle, targetWikiTitle, sourceId)) {
                    written += 1;
                }
            } else {
                // 非顶级条目：直接使用重定向表中的最终目标
                const finalTarget = redirectMap.get(id) || '';
                
                // 在中文来源文件夹直接写重定向到最终模板
                const mainTitle = this.buildMonsterTitle(sourceTranslated, nameZh);
                if (await this.writeRedirectPage(this.bestiaryDir, mainTitle, finalTarget, sourceTranslated)) {
                    written += 1;
                }
                
                // 在 id 来源文件夹也直接写重定向到最终模板
                const zhRedirectTitle = this.buildMonsterTitle(sourceId, nameZh);
                const enRedirectTitle = this.buildMonsterTitle(sourceId, nameEn);
                
                if (await this.writeRedirectPage(this.bestiaryDir, zhRedirectTitle, finalTarget, sourceId)) {
                    written += 1;
                }
                if (await this.writeRedirectPage(this.bestiaryDir, enRedirectTitle, finalTarget, sourceId)) {
                    written += 1;
                }
            }
        }

        return written;
    }
}

export type { WikiPageGenerationResult };
