import { promises as fs } from 'fs';
import path from 'path';

interface ItemData {
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

interface ItemExporterResult {
    count: number;
    baseCount: number;
    variantCount: number;
}

const generateItemNameList = async (
    allItems: ItemData[],
    namelistDir: string
): Promise<void> => {
    const namelistData = allItems.map(item => ({
        id: item.id || '',
        src: item.mainSource?.source || '',
        name_en: item.displayName?.en || '',
        name_zh: item.displayName?.zh || item.displayName?.en || ''
    }));

    const output = {
        type: 'item',
        data: namelistData
    };

    const outputPath = path.join(namelistDir, 'itemnamelist.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`已生成 itemnamelist.json 文件：${outputPath}`);
};

export const runItemExporter = async (
    baseItemMgr: { generateFiles: () => Promise<void>; db: Map<string, ItemData> },
    itemMgr: { generateFiles: () => Promise<void>; db: Map<string, ItemData> },
    magicVariantMgr: { generateFiles: () => Promise<void>; db: Map<string, ItemData> }
): Promise<ItemExporterResult> => {
    await baseItemMgr.generateFiles();
    await itemMgr.generateFiles();
    await magicVariantMgr.generateFiles();

    const normalCount = itemMgr.db.size;
    const variantCount = magicVariantMgr.db.size;
    const count = baseItemMgr.db.size + normalCount + variantCount;

    const namelistDir = path.join('./output', 'namelist');
    await fs.mkdir(namelistDir, { recursive: true });

    const allItems = [
        ...Array.from(baseItemMgr.db.values()),
        ...Array.from(itemMgr.db.values()),
        ...Array.from(magicVariantMgr.db.values())
    ];

    await generateItemNameList(allItems, namelistDir);

    return { count, baseCount: baseItemMgr.db.size, variantCount };
};
