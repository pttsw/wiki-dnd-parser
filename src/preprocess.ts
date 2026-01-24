import fs from 'fs/promises';
import path from 'path';
import { ItemBaseFile, ItemFile } from './types/items';
import config, { strCodec } from './config';

(async () => {
    // 物品部分
    const enRoot = path.dirname(config.DATA_EN_DIR);
    const cnRoot = path.dirname(config.DATA_ZH_DIR);
    const itemBaseFile = {
        en: JSON.parse(
            await fs.readFile(path.join(enRoot, 'item-base.json'), 'utf-8')
        ) as ItemBaseFile,
        cn: JSON.parse(
            await fs.readFile(path.join(cnRoot, 'item-base.json'), 'utf-8')
        ) as ItemBaseFile,
    };
    const itemFile = {
        en: JSON.parse(await fs.readFile(path.join(enRoot, 'items.json'), 'utf-8')) as ItemFile,
        cn: JSON.parse(await fs.readFile(path.join(cnRoot, 'items.json'), 'utf-8')) as ItemFile,
    };



})();
