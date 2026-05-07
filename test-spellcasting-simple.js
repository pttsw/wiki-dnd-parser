// 简化的测试脚本
console.log('=== 测试 spellcasting 处理逻辑 ===');

function processSpellcasting(data) {
    try {
        if (data.spellcasting && typeof data.spellcasting === 'object') {
            transformSpellcastingSpells(data.spellcasting);
        }
        if (data.en && data.en.spellcasting && typeof data.en.spellcasting === 'object') {
            transformSpellcastingSpells(data.en.spellcasting);
        }
        if (data.zh && data.zh.spellcasting && typeof data.zh.spellcasting === 'object') {
            transformSpellcastingSpells(data.zh.spellcasting);
        }
    } catch (e) {
        console.error('Error processing spellcasting:', e);
    }
}

function transformSpellcastingSpells(spellcasting) {
    if (!spellcasting || typeof spellcasting !== 'object') return;
    
    if (spellcasting.spells && typeof spellcasting.spells === 'object' && !Array.isArray(spellcasting.spells)) {
        try {
            const spellsObj = spellcasting.spells;
            const transformed = [];
            
            for (const [key, value] of Object.entries(spellsObj)) {
                if (typeof value === 'object') {
                    const item = { ...value };
                    const level = parseInt(key, 10);
                    if (!isNaN(level)) {
                        item.level = level;
                    }
                    transformed.push(item);
                }
            }
            
            transformed.sort((a, b) => {
                const aLevel = a.level ?? 0;
                const bLevel = b.level ?? 0;
                return aLevel - bLevel;
            });
            spellcasting.spells = transformed;
        } catch (e) {
            console.error('Error transforming spells:', e);
        }
    }
    
    if (spellcasting.daily && typeof spellcasting.daily === 'object' && !Array.isArray(spellcasting.daily)) {
        try {
            const dailyObj = spellcasting.daily;
            const transformed = [];
            
            for (const [key, spells] of Object.entries(dailyObj)) {
                if (Array.isArray(spells)) {
                    transformed.push({
                        times: key,
                        spells: spells
                    });
                }
            }
            
            transformed.sort((a, b) => {
                const aHasE = typeof a.times === 'string' && a.times.endsWith('e');
                const bHasE = typeof b.times === 'string' && b.times.endsWith('e');
                
                if (aHasE && !bHasE) return -1;
                if (!aHasE && bHasE) return 1;
                
                const aNum = typeof a.times === 'string' ? parseInt(a.times.replace('e', ''), 10) : 0;
                const bNum = typeof b.times === 'string' ? parseInt(b.times.replace('e', ''), 10) : 0;
                
                return bNum - aNum;
            });
            
            spellcasting.daily = transformed;
        } catch (e) {
            console.error('Error transforming daily:', e);
        }
    }
}

// 测试数据
const testData = {
    spellcasting: {
        ability: "charisma",
        dc: 15,
        mod: 7,
        spells: {
            "0": { spells: ["{@spell 火焰箭}", "{@spell 神导术}"] },
            "2": { lower: 1, slots: 2, spells: ["{@spell 燃烧之手}"] }
        },
        daily: {
            "2e": ["{@spell animate dead}"],
            "1e": ["{@spell finger of death}"],
            "3": ["{@spell fireball}"],
            "1": ["{@spell lightning bolt}"]
        }
    },
    en: {
        spellcasting: {
            spells: {
                "1": { spells: ["{@spell magic missile}"] }
            }
        }
    },
    zh: {}
};

console.log('测试前:');
console.log(JSON.stringify(testData, null, 2));

processSpellcasting(testData);

console.log('\n测试后:');
console.log(JSON.stringify(testData, null, 2));

console.log('\n=== 测试完成 ===');
