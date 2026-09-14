import { promises as fs } from 'fs';
import path from 'path';

/** namelist 单条记录结构 */
export interface NamelistEntry {
    id: string;
    src: string;
    name_en: string;
    name_zh: string;
    ishomebrew?: boolean;
    ispartnered?: boolean;
}

/**
 * 写入时注册的 namelist 注册表。
 * 各 exporter 在写入输出文件时同步调用 register()，
 * 所有 exporter 完成后由 generateFiles() 统一生成 namelist 文件。
 */
class NamelistRegistry {
    /** category -> entries[] */
    private entries: Map<string, NamelistEntry[]> = new Map();

    /**
     * 注册一个条目。每次写入输出文件时调用。
     * 兼容两种格式：
     *  - 标准格式：{ id, mainSource: { source }, displayName: { en, zh }, ishomebrew, ispartnered }
     *  - 扁平格式：{ id, src, name_en, name_zh, ishomebrew, ispartnered } （冒险条目）
     * @param category 分类名（如 'spell', 'item', 'bestiary' 等）
     * @param item 写入的数据对象
     */
    register(category: string, item: Record<string, any>): void {
        const id = item.id || '';
        // 兼容扁平格式（src）和标准格式（mainSource.source）
        const src = item.src || item.mainSource?.source || '';
        // 兼容扁平格式（name_en）和标准格式（displayName.en）
        const name_en = item.name_en || item.displayName?.en || '';
        // 兼容扁平格式（name_zh）和标准格式（displayName.zh）
        const name_zh = item.name_zh || item.displayName?.zh || name_en;
        // 只有有意义的条目才注册
        if (!id && !name_en && !src) return;

        const entry: NamelistEntry = {
            id,
            src,
            name_en,
            name_zh,
        };

        // 条件展开：只在为 true 时包含该字段
        if (item.ishomebrew) entry.ishomebrew = true;
        if (item.ispartnered) entry.ispartnered = true;

        let list = this.entries.get(category);
        if (!list) {
            list = [];
            this.entries.set(category, list);
        }
        list.push(entry);
    }

    /**
     * 获取某来源 ID 包含的所有数据类型（用于 Sources.json 的 have 字段）。
     * 返回 Map<sourceId, Set<category>>
     */
    getSourceCategories(): Map<string, Set<string>> {
        const result = new Map<string, Set<string>>();
        for (const [category, items] of this.entries) {
            for (const item of items) {
                if (item.src) {
                    if (!result.has(item.src)) {
                        result.set(item.src, new Set());
                    }
                    result.get(item.src)!.add(category);
                }
            }
        }
        return result;
    }

    /**
     * 统一生成所有 namelist 文件。
     * @param namelistDir 输出目录，默认为 './output/namelist'
     */
    async generateFiles(namelistDir: string = './output/namelist'): Promise<void> {
        await fs.mkdir(namelistDir, { recursive: true });
        for (const [category, items] of this.entries) {
            const output = { type: category, data: items };
            const outputPath = path.join(namelistDir, `${category}namelist.json`);
            await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
            console.log(`已生成 ${category}namelist.json (${items.length} 条)`);
        }
    }

    /** 清空所有注册数据（用于测试或重新生成） */
    clear(): void {
        this.entries.clear();
    }
}

/** 全局单例 */
export const namelistRegistry = new NamelistRegistry();