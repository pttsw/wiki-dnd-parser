#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

console.log('=== 测试 spellcasting 处理逻辑 ===');

// 测试数据
const testSpells = {
    "0": {
        "spells": [
            "{@spell 火焰箭}",
            "{@spell 神导术}",
            "{@spell 光亮术}",
            "{@spell 法师之手}",
            "{@spell 魔法伎俩}"
        ]
    },
    "2": {
        "lower": 1,
        "slots": 2,
        "spells": [
            "{@spell 燃烧之手}",
            "{@spell 炽焰法球}",
            "{@spell 炼狱叱喝}",
            "{@spell 灼热射线}"
        ]
    }
};

const testDaily = {
    "2e": [
        "{@spell animate dead} (as an action)",
        "{@spell dispel magic}",
        "{@spell speak with dead}"
    ],
    "1e": [
        "{@spell finger of death}",
        "{@spell plane shift} (self only)",
        "{@spell project image}"
    ]
};

// 转换 spells 函数
function transformSpells(spellsObj) {
    const result = [];
    for (const [key, value] of Object.entries(spellsObj)) {
        const item = { ...value };
        item.level = parseInt(key, 10);
        result.push(item);
    }
    // 按 level 从小到大排序
    result.sort((a, b) => a.level - b.level);
    return result;
}

// 转换 daily 函数
function transformDaily(dailyObj) {
    const result = [];
    for (const [key, spells] of Object.entries(dailyObj)) {
        result.push({
            times: key,
            spells: spells
        });
    }
    // 排序：有e后缀的在前，按数字从大到小；无e后缀的在后，按数字从大到小
    result.sort((a, b) => {
        const aHasE = a.times.endsWith('e');
        const bHasE = b.times.endsWith('e');
        
        if (aHasE && !bHasE) return -1;
        if (!aHasE && bHasE) return 1;
        
        const aNum = parseInt(a.times.replace('e', ''), 10);
        const bNum = parseInt(b.times.replace('e', ''), 10);
        
        return bNum - aNum;
    });
    return result;
}

console.log('原始 spells:');
console.log(JSON.stringify(testSpells, null, 2));
console.log('\n转换后的 spells:');
console.log(JSON.stringify(transformSpells(testSpells), null, 2));

console.log('\n\n原始 daily:');
console.log(JSON.stringify(testDaily, null, 2));
console.log('\n转换后的 daily:');
console.log(JSON.stringify(transformDaily(testDaily), null, 2));
