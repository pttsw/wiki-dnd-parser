import fs from 'fs';

const testData = {
    zh: {
        spellcasting: [
            {
                type: 'innate',
                spells: {
                    "1": { atwill: ['魔法飞弹'] },
                    "2": { daily: ['火焰箭'] },
                    "3": { daily: ['闪电箭'] }
                }
            }
        ]
    },
    en: {
        spellcasting: [
            {
                type: 'innate',
                daily: {
                    "1e": ['magic missile'],
                    "3": ['fireball'],
                    "2e": ['lightning bolt']
                }
            }
        ]
    }
};

function spellcastingReplacer(key, value) {
    if (key === 'spells' && value && typeof value === 'object' && !Array.isArray(value)) {
        const transformed = [];
        for (const [k, v] of Object.entries(value)) {
            if (typeof v === 'object') {
                const item = { ...v };
                const level = parseInt(k, 10);
                if (!isNaN(level)) {
                    item.level = level;
                }
                transformed.push(item);
            }
        }
        transformed.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
        return transformed;
    }
    
    if (key === 'daily' && value && typeof value === 'object' && !Array.isArray(value)) {
        const transformed = [];
        for (const [k, spells] of Object.entries(value)) {
            if (Array.isArray(spells)) {
                transformed.push({ times: k, spells });
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
        return transformed;
    }
    
    return value;
}

try {
    console.log('Before transformation:');
    console.log(JSON.stringify(testData, null, 2));
    
    const transformed = JSON.parse(JSON.stringify(testData, spellcastingReplacer));
    
    console.log('\nAfter transformation:');
    console.log(JSON.stringify(transformed, null, 2));
    
    fs.writeFileSync('./test-output.json', JSON.stringify(transformed, null, 2));
    console.log('\nTest completed successfully!');
} catch (e) {
    console.error('Error:', e);
    process.exit(1);
}