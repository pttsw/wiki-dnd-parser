import { promises as fs } from 'fs';
import path from 'path';
import { escapeFileName } from './shared.js';
import config, { mwUtil } from '../config.js';

interface FeatData {
    dataType: string;
    uid: string;
    id: string;
    displayName: {
        zh: string | null;
        en: string | null;
    };
    mainSource: {
        source: string;
        page: number;
    };
}

interface FeatExporterResult {
    count: number;
}

const generateFeatNameList = async (
    feats: FeatData[],
    namelistDir: string
): Promise<void> => {
    const namelistData = feats.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || '',
        ishomebrew: !!item.ishomebrew
    }));

    const output = {
        type: 'feat',
        data: namelistData
    };

    const outputPath = path.join(namelistDir, 'featnamelist.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 featnamelist.json 文件：${outputPath}`);
};

export const runFeatExporter = async (
    featMgr: { generateFiles: () => Promise<void>; db: Map<string, FeatData> }
): Promise<FeatExporterResult> => {
    await featMgr.generateFiles();
    const count = featMgr.db.size;

    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    await generateFeatNameList(
        Array.from(featMgr.db.values()),
        namelistDir
    );

    return { count };
};