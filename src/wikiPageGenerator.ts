import { promises as fs } from 'fs';
import path from 'path';
import { BookFile } from './types/books.js';
import { WikiItemData } from './types/items.js';
import { WikiSpellData } from './types/spells.js';

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
    outputRoot?: string;
    logger?: (message: string) => void;
};

type WikiPageGenerationResult = {
    spellFiles: number;
    itemFiles: number;
    failed: number;
    skippedSelfRedirects: number;
    pageConflicts: number;
};

export class WikiPageGenerator {
    private readonly outputRoot: string;
    private readonly spellsDir: string;
    private readonly itemsDir: string;
    private readonly spells: Map<string, WikiSpellData>;
    private readonly itemIndex: Map<string, WikiItemData> = new Map();
    private readonly sourceNames: Map<string, SourceNameEntry> = new Map();
    private readonly writtenFiles: Map<string, string> = new Map();
    private readonly logger: (message: string) => void;
    private skippedSelfRedirects = 0;
    private pageConflicts = 0;

    constructor(options: WikiPageGeneratorOptions) {
        this.outputRoot = options.outputRoot || './output_page';
        this.spellsDir = path.join(this.outputRoot, 'spells');
        this.itemsDir = path.join(this.outputRoot, 'items');
        this.spells = options.spells;
        this.logger = options.logger || (() => {});

        this.buildSourceNameIndex(options.books);
        this.buildItemIndex(options.baseItems, options.items, options.magicVariants);
    }

    async generateAll(): Promise<WikiPageGenerationResult> {
        await fs.mkdir(this.spellsDir, { recursive: true });
        await fs.mkdir(this.itemsDir, { recursive: true });

        const spellFiles = await this.generateSpellPages();
        const itemFiles = await this.generateItemPages();

        return {
            spellFiles,
            itemFiles,
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
        return `法术_1_${this.sanitizeFileSegment(sourcePart)}_1_${this.sanitizeFileSegment(namePart)}`;
    }

    private buildItemTitle(sourcePart: string, namePart: string): string {
        return `物品_1_${this.sanitizeFileSegment(sourcePart)}_1_${this.sanitizeFileSegment(namePart)}`;
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

    private async writePage(dir: string, title: string, content: string): Promise<boolean> {
        const filePath = path.join(dir, `${title}.wiki`);
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
        targetTitle: string
    ): Promise<boolean> {
        if (title === targetTitle) {
            this.skippedSelfRedirects += 1;
            return false;
        }
        return this.writePage(dir, title, `#重定向 [[${this.toWikiTitle(targetTitle)}]]`);
    }

    private async generateSpellPages(): Promise<number> {
        let written = 0;

        for (const [, spell] of this.spells) {
            const sourceId = spell.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(spell);
            const nameEn = this.getRawNameEn(spell);
            const mainTitle = this.buildSpellTitle(sourceTranslated, nameZh);

            if (
                await this.writePage(
                    this.spellsDir,
                    mainTitle,
                    `{{法术卡|${nameZh}|${sourceId}}}`
                )
            ) {
                written += 1;
            }

            const zhRedirectTitle = this.buildSpellTitle(sourceId, nameZh);
            if (await this.writeRedirectPage(this.spellsDir, zhRedirectTitle, mainTitle)) {
                written += 1;
            }

            const enRedirectTitle = this.buildSpellTitle(sourceId, nameEn);
            if (await this.writeRedirectPage(this.spellsDir, enRedirectTitle, mainTitle)) {
                written += 1;
            }
        }

        return written;
    }

    private async generateItemPages(): Promise<number> {
        let written = 0;

        for (const [, item] of this.itemIndex) {
            const sourceId = item.mainSource.source;
            const sourceTranslated = this.resolveSourceName(sourceId);
            const nameZh = this.getRawNameZh(item);
            const nameEn = this.getRawNameEn(item);
            const mainTitle = this.buildItemTitle(sourceTranslated, nameZh);
            const hierarchy = this.normalizeItemHierarchy(item);

            let mainContent: string;
            if (hierarchy.fork === 0 || !hierarchy.superiorId) {
                mainContent = `{{物品卡|${nameZh}|${sourceId}}}`;
            } else {
                const topItem = this.resolveTopItem(item);
                const topTitle = this.buildItemTitle(
                    this.resolveSourceName(topItem.mainSource.source),
                    this.getRawNameZh(topItem)
                );

                if (hierarchy.inheritsreq) {
                    const originItem = this.resolveOriginItem(item);
                    const originNameZh = this.getRawNameZh(originItem);
                    mainContent = `#重定向 [[${this.toWikiTitle(topTitle)}#${originNameZh}]]`;
                } else {
                    mainContent = `#重定向 [[${this.toWikiTitle(topTitle)}#${nameZh}]]`;
                }
            }

            if (await this.writePage(this.itemsDir, mainTitle, mainContent)) {
                written += 1;
            }

            // 检查 mainContent 是否是重定向内容
            let redirectTarget = mainTitle;
            const redirectMatch = mainContent.match(/^#重定向 \[\[(.*?)\]\]$/);
            if (redirectMatch) {
                // 提取重定向目标的 wiki 标题
                const wikiTarget = redirectMatch[1];
                // 将 wiki 标题转换回文件标题格式
                redirectTarget = wikiTarget.replace(/\//g, '_1_');
            }

            const zhRedirectTitle = this.buildItemTitle(sourceId, nameZh);
            if (await this.writeRedirectPage(this.itemsDir, zhRedirectTitle, redirectTarget)) {
                written += 1;
            }

            const enRedirectTitle = this.buildItemTitle(sourceId, nameEn);
            if (await this.writeRedirectPage(this.itemsDir, enRedirectTitle, redirectTarget)) {
                written += 1;
            }
        }

        return written;
    }
}

export type { WikiPageGenerationResult };
