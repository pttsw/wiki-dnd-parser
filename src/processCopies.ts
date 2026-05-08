import fs from 'fs/promises';
import path from 'path';
import config from './config.js';
import { resolveCopiesInDirectory } from './copyResolver.js';

const getTimestamp = () => {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
};

console.log(`[${getTimestamp()}] 开始处理 input 目录的 _copy...`);

// 获取绝对路径
const rootDir = process.cwd();
const dataEnDir = path.join(rootDir, config.DATA_EN_DIR);
const dataZhDir = path.join(rootDir, config.DATA_ZH_DIR);

console.log(`[${getTimestamp()}] 英文数据路径:`, dataEnDir);
console.log(`[${getTimestamp()}] 中文数据路径:`, dataZhDir);

// 备份原始数据
const backupEnDir = path.join(rootDir, 'input', '5e-en', 'data_backup');
const backupZhDir = path.join(rootDir, 'input', '5e-cn', 'data_backup');

try {
    // 检查源目录是否存在
    const [enExists, zhExists] = await Promise.all([
        fs.access(dataEnDir).then(() => true).catch(() => false),
        fs.access(dataZhDir).then(() => true).catch(() => false)
    ]);

    if (!enExists && !zhExists) {
        console.error(`[${getTimestamp()}] 错误: 找不到 data 目录!`);
        console.error(`       请先运行 npm run getCnRepo 拉取数据, 或者确保 input/5e-en/data 和 input/5e-cn/data 存在。`);
        process.exit(1);
    }

    // 备份原始数据
    console.log(`[${getTimestamp()}] 备份原始数据...`);
    if (enExists) {
        try {
            await fs.rm(backupEnDir, { recursive: true, force: true });
            await fs.cp(dataEnDir, backupEnDir, { recursive: true });
            console.log(`[${getTimestamp()}] 英文数据已备份至:`, backupEnDir);
        } catch (e) {
            console.warn(`[${getTimestamp()}] 备份英文数据失败:`, e);
        }
    }
    if (zhExists) {
        try {
            await fs.rm(backupZhDir, { recursive: true, force: true });
            await fs.cp(dataZhDir, backupZhDir, { recursive: true });
            console.log(`[${getTimestamp()}] 中文数据已备份至:`, backupZhDir);
        } catch (e) {
            console.warn(`[${getTimestamp()}] 备份中文数据失败:`, e);
        }
    }

    // 处理英文数据
    if (enExists) {
        console.log(`\n[${getTimestamp()}] 处理英文数据...`);
        await resolveCopiesInDirectory(dataEnDir, dataEnDir);
    }

    // 处理中文数据
    if (zhExists) {
        console.log(`\n[${getTimestamp()}] 处理中文数据...`);
        await resolveCopiesInDirectory(dataZhDir, dataZhDir);
    }

    console.log(`\n[${getTimestamp()}] 所有 _copy 处理完成！`);
    console.log(`[${getTimestamp()}] 现在可以运行 npm run start 生成输出文件了。`);

} catch (error) {
    console.error(`[${getTimestamp()}] 处理过程中发生错误:`, error);
    process.exit(1);
}
