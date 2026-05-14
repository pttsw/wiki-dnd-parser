import { promises as fs } from 'fs';
import path from 'path';

interface SpellData {
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

interface SpellExporterResult {
    count: number;
}

const generateSpellNameList = async (
    spells: SpellData[],
    namelistDir: string
): Promise<void> => {
    const namelistData = spells.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));

    const output = {
        type: 'spell',
        data: namelistData
    };

    const outputPath = path.join(namelistDir, 'spellnamelist.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 spellnamelist.json 文件：${outputPath}`);
};

export const runSpellExporter = async (
    spellMgr: { generateFiles: () => Promise<void>; db: Map<string, SpellData> }
): Promise<SpellExporterResult> => {
    await spellMgr.generateFiles();
    const count = spellMgr.db.size;

    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    await generateSpellNameList(
        Array.from(spellMgr.db.values()),
        namelistDir
    );

    return { count };
};
