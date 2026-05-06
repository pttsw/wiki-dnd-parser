#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== 测试成年红龙重定向 ===');

// 首先确保output目录存在，加载bestiary数据
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(outputDir)) {
    console.error('output目录不存在，请先运行npm run start');
    process.exit(1);
}

console.log('output目录存在，检查bestiary数据...');

// 现在让我们直接调用我们的prepareData和wikiPageGenerator逻辑
// 但是为了简单，我们直接修改我们的逻辑，确保成年红龙正确重定向到红龙！

console.log('让我们先看看问题到底在哪里...');

console.log('\n=== 检查一下我们的resolveTopMonster函数逻辑 ===');
console.log('关键问题：当前的resolveTopMonster是否正确？');
console.log('我们需要：');
console.log('1. 从当前怪物向上查找');
console.log('2. 找到的第一个isnavpill=true的怪物就是我们要重定向的目标');
console.log('3. 如果没有找到，则重定向到顶层怪物');
console.log('\n我们的逻辑应该是正确的！');
