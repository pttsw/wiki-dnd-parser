#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

console.log('=== 测试 spellcasting 处理逻辑 ===');

// 测试完整的 spellcasting 对象
const testSpellcasting = {
    "ability": "charisma",
    "dc": 15,
    "mod": 7,
    "spells": {
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
    },
    "daily": {
        "2e": [
            "{@spell animate dead} (as an action)",
            "{@spell dispel magic}",
            "{@spell speak with dead}"
        ],
        "1e": [
            "{@spell finger of death}",
            "{@spell plane shift} (self only)",
            "{@spell project image}"
        ],
        "3": [
            "{@spell fireball}"
        ],
        "1": [
            "{@spell lightning bolt}"
        ]
    }
};

// 转换 spells 函数
function transformSpells(spellsObj) {
    const result = [];
    for (const [key, value] of Object.entries(spellsObj)) {
        const item = { ...value };
        item.level = parseInt(key, 10);
        result.push(item);
    }
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

// 处理完整的 spellcasting
function processSpellcasting(spellcasting) {
    if (spellcasting.spells && typeof spellcasting.spells === 'object' && !Array.isArray(spellcasting.spells)) {
        spellcasting.spells = transformSpells(spellcasting.spells);
    }
    
    if (spellcasting.daily && typeof spellcasting.daily === 'object' && !Array.isArray(spellcasting.daily)) {
        spellcasting.daily = transformDaily(spellcasting.daily);
    }
}

console.log('原始 spellcasting:');
console.log(JSON.stringify(testSpellcasting, null, 2));

processSpellcasting(testSpellcasting);

console.log('\n处理后的 spellcasting:');
console.log(JSON.stringify(testSpellcasting, null, 2));

// 验证结果
console.log('\n=== 验证结果 ===');
console.log('spells 是数组:', Array.isArray(testSpellcasting.spells));
console.log('daily 是数组:', Array.isArray(testSpellcasting.daily));
console.log('spells[0].level:', testSpellcasting.spells[0].level);
console.log('spells[1].level:', testSpellcasting.spells[1].level);
console.log('daily[0].times:', testSpellcasting.daily[0].times);
console.log('daily[1].times:', testSpellcasting.daily[1].times);
console.log('daily[2].times:', testSpellcasting.daily[2].times);
console.log('daily[3].times:', testSpellcasting.daily[3].times);
