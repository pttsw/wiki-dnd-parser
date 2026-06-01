import { parse } from 'path';
import fs from 'fs/promises';
import { sectionTextIdMap } from './exporters/shared.js';
import type {
    ParaghaphInset,
    ParagraphCell,
    ParagraphContentTypes,
    ParagraphEntries,
    ParagraphHref,
    ParagraphImage,
    ParagraphInsetReadaloud,
    ParagraphInline,
    ParagraphLink,
    ParagraphGroup,
    ParagraphList,
    ParagraphListItem,
    ParagraphQuote,
    ParagraphSection,
    ParagraphStatblockInline,
    ParagraphTable,
} from './types/typography';

interface TagEntry {
    tagName: string;
    param: string | null;
}

class TagParser {
    allTags: Map<string, Set<string>> = new Map();
    constructor() {}
    /**
     * 解析一个字符串，将其中的tag提取并使用parseSingleTag方法处理，拼合后返回一个字符串。
     * @param input
     * @returns
     */
    parse(input: string | number | undefined): string {
        if (typeof input !== 'string') {
            if (!input) {
                return '';
            }
            return String(input);
        }
        const tagRegex = /{(@\w+)(?:\s+([^}]+))?}/g;
        const parts: (string | TagEntry)[] = [];
        let lastIndex = 0;
        for (const match of input.matchAll(tagRegex)) {
            const [fullMatch, tagName, param] = match;

            if (lastIndex < match.index) {
                parts.push(input.slice(lastIndex, match.index));
            }
            parts.push({ tagName, param: param || null });
            lastIndex = match.index + fullMatch.length;
        }
        if (lastIndex < input.length) {
            parts.push(input.slice(lastIndex));
        }

        const output: string[] = [];
        for (const part of parts) {
            if (typeof part === 'string') output.push(part);
            else {
                output.push(this.parseSingleTag(part));
            }
        }
        return output.join('');
    }
    parseSingleTag(tag: TagEntry): string {
        // 处理{@item}标签，为没有来源后缀的物品添加|DMG后缀
        if (tag.tagName === '@item' && tag.param) {
            const parts = tag.param.split('|');
            // 检查是否有来源后缀（parts[1]应该是来源，parts[2]应该是显示文本）
            if (parts.length >= 2 && !parts[1].trim()) {
                // 格式为 {@item name||display}，没有来源后缀，添加|DMG
                const result = `{${tag.tagName} ${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}}`;
                // 保存处理后的参数
                if (this.allTags.has(tag.tagName)) {
                    this.allTags.get(tag.tagName)!.add(`${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}`);
                } else {
                    this.allTags.set(tag.tagName, new Set([`${parts[0]}|DMG${parts.length > 2 ? '|' + parts.slice(2).join('|') : ''}`]));
                }
                return result;
            } else if (parts.length === 1) {
                // 格式为 {@item name}，没有来源后缀，添加|DMG
                const result = `{${tag.tagName} ${parts[0]}|DMG}`;
                // 保存处理后的参数
                if (this.allTags.has(tag.tagName)) {
                    this.allTags.get(tag.tagName)!.add(`${parts[0]}|DMG`);
                } else {
                    this.allTags.set(tag.tagName, new Set([`${parts[0]}|DMG`]));
                }
                return result;
            }
        }

        // 处理{@book}标签，替换章节索引为textId
        if (tag.tagName === '@book' && tag.param) {
            const parts = tag.param.split('|');
            const displayText = parts[0];
            const bookId = parts[1] || '';
            const chapterIndexOrTextIdStr = parts[2];
            const sectionTitle = parts[3];
            const number = parts[4];

            let chapterIndexOrTextId: string | number | undefined;
            if (chapterIndexOrTextIdStr) {
                const parsed = parseInt(chapterIndexOrTextIdStr, 10);
                if (!isNaN(parsed)) {
                    chapterIndexOrTextId = parsed;
                } else {
                    chapterIndexOrTextId = chapterIndexOrTextIdStr;
                }
            }

            // 尝试获取textId
            let textId: string | null = null;
            if (bookId) {
                // 策略1：有 bookId 和 chapterIndexOrTextId 时，先尝试查找
                if (chapterIndexOrTextId !== undefined) {
                    textId = sectionTextIdMap.getTextId(bookId, chapterIndexOrTextId, sectionTitle);
                }
                
                // 策略2：如果没找到，尝试只用 sectionTitle 查找
                if (!textId && sectionTitle) {
                    textId = sectionTextIdMap.getTextIdByTitleOnly(bookId, sectionTitle);
                }
                
                // 策略3：如果还没找到，使用 chapterIndexOrTextId 作为 textId
                if (!textId && chapterIndexOrTextId !== undefined) {
                    textId = String(chapterIndexOrTextId);
                }
            }

            // 构建新的标签参数
            let newParam = displayText;
            if (bookId) {
                newParam += `|${bookId}`;
                if (textId) {
                    newParam += `|${textId}`;
                    if (sectionTitle) {
                        newParam += `|${sectionTitle}`;
                    }
                    if (number) {
                        newParam += `|${number}`;
                    }
                } else {
                    // 没有找到textId，保持原样
                    if (chapterIndexOrTextIdStr) newParam += `|${chapterIndexOrTextIdStr}`;
                    if (sectionTitle) newParam += `|${sectionTitle}`;
                    if (number) newParam += `|${number}`;
                }
            }

            // 保存处理后的参数
            if (this.allTags.has(tag.tagName)) {
                this.allTags.get(tag.tagName)!.add(newParam);
            } else {
                this.allTags.set(tag.tagName, new Set([newParam]));
            }

            return `{${tag.tagName} ${newParam}}`;
        }

        // 保存原始参数
        if (this.allTags.has(tag.tagName)) {
            this.allTags.get(tag.tagName)!.add(tag.param || '');
        } else {
            this.allTags.set(tag.tagName, new Set([tag.param || '']));
        }

        return `{${tag.tagName}${tag.param ? ` ${tag.param}` : ''}}`;
    }
    async generateFiles() {
        // save allTags to ./output/tags.json
        const outputDir = './output';
        await fs.mkdir(outputDir, { recursive: true });
        const filePath = `${outputDir}/tags.json`;
        const data = Array.from(this.allTags.entries()).map(([tagName, params]) => ({
            tagName,
            params: Array.from(params),
        }));
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}

export const tagParser = new TagParser();
const tag = tagParser.parse.bind(tagParser);

export const parseContent = (content: ParagraphGroup): string => {
    const output: string[] = [];
    for (const item of content) {
        output.push(parseSingleParagraph(item));
    }
    return output.join('\n');
};

const escapeAttribute = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const resolveHref = (href?: ParagraphHref): string => {
    if (!href) return '#';
    const base = href.url || href.path || '#';
    return href.hash ? `${base}#${href.hash}` : base;
};

const parseLink = (item: ParagraphLink): string => {
    const href = escapeAttribute(resolveHref(item.href));
    const text = tag(item.text || resolveHref(item.href));
    return `<a class="parser-link" href="${href}">${text}</a>`;
};

const parseInline = (item: ParagraphInline): string =>
    `<span class="parser-inline">${item.entries
        .map(entry => {
            if (typeof entry === 'string' || typeof entry === 'number') return tag(entry);
            if (entry?.type === 'link') return parseLink(entry);
            return '';
        })
        .join('')}</span>`;

const parseImage = (item: ParagraphImage): string => {
    const src = escapeAttribute(resolveHref(item.href));
    const title = item.title ? tag(item.title) : '';
    const credit = item.credit ? tag(item.credit) : '';
    const width = typeof item.width === 'number' ? ` width="${item.width}"` : '';
    const height = typeof item.height === 'number' ? ` height="${item.height}"` : '';
    const alt = escapeAttribute(item.title || item.credit || 'image');

    let html = `<figure class="parser-image"><img class="parser-image-img" src="${src}" alt="${alt}"${width}${height}>`;
    if (title || credit) {
        html += '<figcaption class="parser-image-caption">';
        if (title) html += `<span class="parser-image-title">${title}</span>`;
        if (credit) html += `<span class="parser-image-credit">${credit}</span>`;
        html += '</figcaption>';
    }
    html += '</figure>';
    return html;
};

const parseStatblockInline = (item: ParagraphStatblockInline): string => {
    const name = item.data?.ENG_name || item.data?.name || '';
    const source = item.data?.source ? escapeAttribute(String(item.data.source)) : '';
    const dataType = item.dataType ? escapeAttribute(item.dataType) : 'unknown';
    const page =
        typeof item.data?.page === 'number' ? ` data-page="${item.data.page}"` : '';
    return `<div class="parser-statblock-inline" data-statblock-type="${dataType}"${
        source ? ` data-source="${source}"` : ''
    }${page}>${tag(name)}</div>`;
};

const parseInsetReadaloud = (item: ParagraphInsetReadaloud): string => {
    let html = `<div class="parser-inset-readaloud">`;
    if (item.name) {
        html += `<div class="parser-inset-readaloud-name">${tag(item.name)}</div>`;
    }
    html += `<div class="parser-inset-readaloud-content">`;
    for (const entry of item.entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseSingleParagraph = (item: ParagraphContentTypes): string => {
    if (typeof item === 'string') {
        return tag(item);
    } else if (item.type === 'inline') {
        return parseInline(item);
    } else if (item.type === 'image') {
        return parseImage(item);
    } else if (item.type === 'statblockInline') {
        return parseStatblockInline(item);
    } else if (item.type === 'table') {
        return parseTable(item);
    } else if (item.type === 'inset') {
        return parseInset(item);
    } else if (item.type === 'insetReadaloud') {
        return parseInsetReadaloud(item);
    } else if (item.type === 'entries') {
        return parseEntries(item);
    } else if (item.type === 'list') {
        return parseList(item);
    } else if (item.type === 'section') {
        return parseSection(item);
    } else if (item.type === 'quote') {
        return parseQuote(item);
    } else {
        console.error(`Unknown paragraph type: ${JSON.stringify(item)}`);

        throw new Error(`Unknown paragraph type`);
    }
};

const parseTable = (item: ParagraphTable): string => {
    const { caption, colLabels, colStyles, rows } = item;
    let html = '<table class="wiki-table">';
    if (caption) {
        html += `<caption>${tag(caption)}</caption>`;
    }
    html += '<tr>';
    for (let i = 0; i < colLabels.length; i++) {
        html += `<th class="parser-${colStyles[i]}">${tag(colLabels[i])}</th>`;
    }
    html += '</tr>';
    for (const row of rows) {
        html += '<tr>';
        for (let i = 0; i < row.length; i++) {
            const cell = row[i];
            if (typeof cell === 'number' || typeof cell === 'string') {
                html += `<td class="parser-${colStyles[i]}">${tag(cell)}</td>`;
            } else if (cell && typeof cell === 'object') {
                html += parseTableCell(cell);
            }
        }
        html += '</tr>';
    }
    html += '</table>';
    return html;
};
const parseTableCell = (cell: ParagraphCell): string => {
    const { roll, entry } = cell;
    return `<td class="parser-cell" data-roll="${roll.exact}">${tag(entry)}</td>`;
};

const parseInset = (item: ParaghaphInset): string => {
    const { name, page, entries } = item;
    let html = `<div class="parser-inset">`;
    html += `<div class=parser-inset-name>${tag(name)}</div>`;
    html += `<div class=parser-inset-entries>`;
    html += `<div class="parser-inset-page">Page: ${page ?? 'N/A'}</div>`;
    html += `<div class="parser-inset-content">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseEntries = (item: ParagraphEntries): string => {
    const { name, ENG_name, type, entries, page } = item;
    let html = `<div class="parser-entries">`;
    if (name) {
        html += `<div class="parser-entries-name">${tag(name)}</div>`;
    }
    if (ENG_name) {
        html += `<div class="parser-entries-eng-name">${tag(ENG_name)}</div>`;
    }
    if (page) {
        html += `<div class="parser-entries-page">Page: ${tag(page)}</div>`;
    }
    html += `<div class="parser-entries-content">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseListItem = (item: ParagraphListItem): string => {
    const { name, entry, entries, ENG_name } = item;
    let html = `<li class="parser-list-item">`;
    if (name) {
        html += `<span class="parser-list-item-name">${tag(name)}</span>`;
    }
    if (ENG_name) {
        html += `<span class="parser-list-item-eng-name">${tag(ENG_name)}</span>`;
    }
    if (entry) {
        html += `<span class="parser-list-item-entry">${tag(entry)}</span>`;
    }
    if (entries) {
        html += `<div class="parser-list-item-entries">`;
        for (const entry of entries) {
            html += parseSingleParagraph(entry);
        }
        html += `</div>`;
    }
    html += `</li>`;
    return html;
};

const parseList = (item: ParagraphList): string => {
    const { style, items } = item;
    let html = `<ul class="parser-list parser-list-${style || 'default'}">`;
    for (const listItem of items) {
        if (typeof listItem === 'string') {
            html += `<li>${tag(listItem)}</li>`;
        } else if (listItem.type === 'item') {
            html += parseListItem(listItem);
        } else if (listItem.type === 'entries') {
            html += parseEntries(listItem);
        } else if (listItem.type === 'list') {
            html += parseList(listItem);
        }
    }
    html += `</ul>`;
    return html;
};

const parseSection = (item: ParagraphSection): string => {
    const { entries } = item;
    let html = `<div class="parser-section">`;
    if (item.name) {
        html += `<div class="parser-section-name">${tag(item.name)}</div>`;
    }
    html += `<div class="parser-section-entries">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</div>`;
    html += `</div>`;
    return html;
};

const parseQuote = (item: ParagraphQuote): string => {
    const { entries } = item;
    let html = `<blockquote class="parser-quote">`;
    for (const entry of entries) {
        html += parseSingleParagraph(entry);
    }
    html += `</blockquote>`;
    return html;
};
