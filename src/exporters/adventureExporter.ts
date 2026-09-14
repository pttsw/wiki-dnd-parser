import { promises as fs } from 'fs';
import path from 'path';
import { namelistRegistry } from '../namelistRegistry.js';

const removeBOM = (content: string): string => {
    if (content.startsWith('\uFEFF')) {
        return content.slice(1);
    }
    return content;
};

export interface AdventureExporterResult {
    count: number;
}

export const runAdventureExporter = async (): Promise<AdventureExporterResult> => {
    const adventureDataList: Array<{
        id: string;
        src: string;
        name_en: string;
        name_zh: string;
        ishomebrew: boolean;
        ispartnered?: boolean;
    }> = [];

    let adventureDir: string;
    try {
        adventureDir = path.join('./output', 'adventure');
        await fs.access(adventureDir);
    } catch {
        console.log('[AdventureExporter] 未找到 adventure 目录，跳过生成 namelist');
        return { count: 0 };
    }

    let sourceDirs: string[];
    try {
        sourceDirs = await fs.readdir(adventureDir);
    } catch {
        return { count: 0 };
    }

    for (const sourceId of sourceDirs) {
        const sourcePath = path.join(adventureDir, sourceId);
        let stats;
        try {
            stats = await fs.stat(sourcePath);
        } catch {
            continue;
        }
        if (!stats.isDirectory()) continue;

        let files: string[];
        try {
            files = await fs.readdir(sourcePath);
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const filePath = path.join(sourcePath, file);
            let content: string;
            try {
                content = await fs.readFile(filePath, 'utf-8');
            } catch {
                continue;
            }

            try {
                const data = JSON.parse(removeBOM(content));
                if (data.id && data.source) {
                    adventureDataList.push({
                        id: data.id,
                        src: data.source,
                        name_en: data.displayName?.en || '',
                        name_zh: data.displayName?.zh || data.displayName?.en || '',
                        ...(data.ishomebrew ? { ishomebrew: true } : {}),
                        ...(data.ispartnered ? { ispartnered: true } : {})
                    });
                }
            } catch {
                continue;
            }
        }
    }

    if (adventureDataList.length > 0) {
        // 注册到统一 namelist 注册表
        for (const entry of adventureDataList) {
            namelistRegistry.register('adventure', entry);
        }
        console.log(`已注册 ${adventureDataList.length} 条冒险数据到 namelist`);
    }

    return { count: adventureDataList.length };
};