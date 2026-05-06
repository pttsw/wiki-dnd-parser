#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== 检查项目目录 ===');
console.log('当前目录：', __dirname);

const items = fs.readdirSync(__dirname);
console.log('根目录内容：', items);

console.log('\n检查 output 和 output_page 目录：');
const outputDir = path.join(__dirname, 'output');
const outputPageDir = path.join(__dirname, 'output_page');

console.log('output 是否存在：', fs.existsSync(outputDir));
console.log('output_page 是否存在：', fs.existsSync(outputPageDir));

if (fs.existsSync(outputPageDir)) {
    console.log('output_page 内容：');
    const pageItems = fs.readdirSync(outputPageDir);
    console.log(pageItems);
    
    if (pageItems.includes('bestiary')) {
        const bestiaryDir = path.join(outputPageDir, 'bestiary');
        console.log('\nbestiary 目录内容：');
        const bestiaryFiles = fs.readdirSync(bestiaryDir);
        console.log(`有 ${bestiaryFiles.length} 个文件`);
        
        const adultRedDragonFile = bestiaryFiles.find(f => f.includes('成年红龙'));
        if (adultRedDragonFile) {
            console.log('找到成年红龙文件：', adultRedDragonFile);
            const filePath = path.join(bestiaryDir, adultRedDragonFile);
            const content = fs.readFileSync(filePath, 'utf-8');
            console.log('文件内容：');
            console.log(content);
        } else {
            console.log('没有找到成年红龙文件，让我找一下有哪些红龙相关的：');
            const redDragonFiles = bestiaryFiles.filter(f => f.includes('红龙'));
            console.log(redDragonFiles);
        }
    }
}

console.log('\n=== 完成 ===');
