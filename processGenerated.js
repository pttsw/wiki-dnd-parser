import { promises as fs } from 'fs';
import path from 'path';

const config = {
    DATA_EN_DIR: './input/5e-en/data',
    DATA_ZH_DIR: './input/5e-cn/data',
};

async function processGeneratedFiles() {
    const enGeneratedDir = path.join(config.DATA_EN_DIR, 'generated');
    const zhGeneratedDir = path.join(config.DATA_ZH_DIR, 'generated');
    const outputDir = path.join('./output', 'generated');

    // 创建输出目录
    try {
        await fs.mkdir(outputDir, { recursive: true });
        console.log('创建输出目录成功:', outputDir);
    } catch (error) {
        console.error('创建输出目录失败:', error);
        return;
    }

    // 读取英文generated文件夹中的文件
    let enFiles;
    try {
        enFiles = await fs.readdir(enGeneratedDir);
        console.log('读取英文文件目录成功:', enFiles);
    } catch (error) {
        console.error('读取英文文件目录失败:', error);
        return;
    }
    const jsonEnFiles = enFiles.filter(file => file.endsWith('.json'));

    // 读取中文generated文件夹中的文件
    let zhFiles;
    try {
        zhFiles = await fs.readdir(zhGeneratedDir);
        console.log('读取中文文件目录成功:', zhFiles);
    } catch (error) {
        console.error('读取中文文件目录失败:', error);
        return;
    }
    const jsonZhFiles = zhFiles.filter(file => file.endsWith('.json'));

    // 处理英文JSON文件
    for (const file of jsonEnFiles) {
        const inputPath = path.join(enGeneratedDir, file);
        const outputPath = path.join(outputDir, `${path.parse(file).name}-en.json`);
        
        try {
            const data = await fs.readFile(inputPath, 'utf-8');
            const parsedData = JSON.parse(data);
            const formattedData = JSON.stringify(parsedData, null, 2);
            await fs.writeFile(outputPath, formattedData, 'utf-8');
            console.log(`处理完成: ${file} -> ${path.parse(file).name}-en.json`);
        } catch (error) {
            console.error(`处理文件失败: ${file}`, error);
        }
    }

    // 处理中文JSON文件
    for (const file of jsonZhFiles) {
        const inputPath = path.join(zhGeneratedDir, file);
        const outputPath = path.join(outputDir, file);
        
        try {
            const data = await fs.readFile(inputPath, 'utf-8');
            const parsedData = JSON.parse(data);
            const formattedData = JSON.stringify(parsedData, null, 2);
            await fs.writeFile(outputPath, formattedData, 'utf-8');
            console.log(`处理完成: ${file}`);
        } catch (error) {
            console.error(`处理文件失败: ${file}`, error);
        }
    }

    console.log('所有文件处理完成！');
}

// 运行脚本
processGeneratedFiles().catch(error => {
    console.error('处理过程中出现错误:', error);
    process.exit(1);
});
