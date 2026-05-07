#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

console.log('=== 验证 spellcasting 转换 ===');

// 检查输出目录
const outputDir = './output/bestiary';
if (!fs.existsSync(outputDir)) {
    console.log('output/bestiary 目录不存在');
    process.exit(1);
}

console.log('output/bestiary 目录存在');

// 查找一个有spellcasting的怪物文件
const files = fs.readdirSync(outputDir);

// 找第一个有spellcasting的怪物
let found = false;
for (const file of files) {
    const filePath = path.join(outputDir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        if (content.includes('spellcasting')) {
            console.log(`\n找到有spellcasting的怪物: ${file}`);
            const data = JSON.parse(content);
            
            if (data.spellcasting) {
                console.log('spellcasting 内容:');
                console.log(JSON.stringify(data.spellcasting, null, 2));
                console.log('\nspellcasting 的键:', Object.keys(data.spellcasting));
            }
            
            found = true;
            break;
        }
    } catch (e) {
        // 忽略错误
    }
}

if (!found) {
    console.log('没有找到有spellcasting的怪物文件');
}

console.log('\n=== 完成 ===');
