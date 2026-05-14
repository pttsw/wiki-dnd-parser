import { promises as fs } from 'fs';
import path from 'path';

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
    const outputDir = './output';
    const namelistDir = path.join(outputDir, 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    const adventureDataList: Array<{
        id: string;
        src: string;
        name_en: string;
        name_zh: string;
    }> = [];

    let adventureDir: string;
    try {
        adventureDir = path.join(outputDir, 'adventure');
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
                        name_zh: data.displayName?.zh || data.displayName?.en || ''
                    });
                }
            } catch {
                continue;
            }
        }
    }

    if (adventureDataList.length > 0) {
        const output = {
            type: 'adventure',
            data: adventureDataList
        };
        
        const outputPath = path.join(namelistDir, 'adventurelist.json');
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
        console.log(`已生成 adventurelist.json 文件：${outputPath}`);
    }

    return { count: adventureDataList.length };
};
