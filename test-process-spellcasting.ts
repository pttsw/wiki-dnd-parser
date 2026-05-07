// 测试 processSpellcasting 方法
function processSpellcasting(data: Record<string, any>) {
    if (data.spellcasting) {
        transformSpellcastingSpells(data.spellcasting);
    }
    if (data.en?.spellcasting) {
        transformSpellcastingSpells(data.en.spellcasting);
    }
    if (data.zh?.spellcasting) {
        transformSpellcastingSpells(data.zh.spellcasting);
    }
}

function transformSpellcastingSpells(spellcasting: Record<string, any>) {
    if (spellcasting.spells && typeof spellcasting.spells === 'object' && !Array.isArray(spellcasting.spells)) {
        const spellsObj = spellcasting.spells;
        const transformed: any[] = [];
        
        for (const [key, value] of Object.entries(spellsObj)) {
            const item = { ...value };
            item.level = parseInt(key, 10);
            transformed.push(item);
        }
        
        transformed.sort((a, b) => a.level - b.level);
        spellcasting.spells = transformed;
    }
    
    if (spellcasting.daily && typeof spellcasting.daily === 'object' && !Array.isArray(spellcasting.daily)) {
        const dailyObj = spellcasting.daily;
        const transformed: any[] = [];
        
        for (const [key, spells] of Object.entries(dailyObj)) {
            transformed.push({
                times: key,
                spells: spells
            });
        }
        
        transformed.sort((a, b) => {
            const aHasE = a.times.endsWith('e');
            const bHasE = b.times.endsWith('e');
            
            if (aHasE && !bHasE) return -1;
            if (!aHasE && bHasE) return 1;
            
            const aNum = parseInt(a.times.replace('e', ''), 10);
            const bNum = parseInt(b.times.replace('e', ''), 10);
            
            return bNum - aNum;
        });
        
        spellcasting.daily = transformed;
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

console.log('测试前:', JSON.stringify(testData, null, 2));
processSpellcasting(testData);
console.log('测试后:', JSON.stringify(testData, null, 2));
