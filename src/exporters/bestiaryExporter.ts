import { promises as fs } from 'fs';
import path from 'path';

interface BestiaryData {
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

interface BestiaryExporterResult {
    count: number;
}

const generateBestiaryNameList = async (
    bestiary: BestiaryData[],
    namelistDir: string
): Promise<void> => {
    const namelistData = bestiary.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));

    const output = {
        type: 'bestiary',
        data: namelistData
    };

    const outputPath = path.join(namelistDir, 'bestiarynamelist.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 bestiarynamelist.json 文件：${outputPath}`);
};

export const runBestiaryExporter = async (
    bestiaryMgr: { generateFiles: () => Promise<void>; db: Map<string, BestiaryData> }
): Promise<BestiaryExporterResult> => {
    await bestiaryMgr.generateFiles();
    const count = bestiaryMgr.db.size;

    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    await generateBestiaryNameList(
        Array.from(bestiaryMgr.db.values()),
        namelistDir
    );

    return { count };
};
