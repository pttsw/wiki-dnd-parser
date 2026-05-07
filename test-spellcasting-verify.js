import fs from 'fs';
import path from 'path';

async function verifySpellcastingTransformation() {
    const outputDir = './output/bestiary';
    
    // 查找包含spellcasting的怪物文件
    const files = fs.readdirSync(outputDir);
    let foundWithSpells = false;
    
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const content = fs.readFileSync(path.join(outputDir, file), 'utf-8');
        const data = JSON.parse(content);
        
        // 检查是否有spellcasting字段
        const hasSpellcastingZh = data.zh && data.zh.spellcasting && Array.isArray(data.zh.spellcasting);
        const hasSpellcastingEn = data.en && data.en.spellcasting && Array.isArray(data.en.spellcasting);
        
        if (hasSpellcastingZh || hasSpellcastingEn) {
            console.log(`\n找到包含spellcasting的怪物: ${file}`);
            foundWithSpells = true;
            
            if (hasSpellcastingZh) {
                for (const sc of data.zh.spellcasting) {
                    if (sc.spells && Array.isArray(sc.spells)) {
                        console.log('  zh.spells 已转换为数组格式:');
                        console.log('    ', JSON.stringify(sc.spells.slice(0, 3), null, 2).split('\n').join('\n    '));
                    }
                    if (sc.daily && Array.isArray(sc.daily)) {
                        console.log('  zh.daily 已转换为数组格式:');
                        console.log('    ', JSON.stringify(sc.daily.slice(0, 3), null, 2).split('\n').join('\n    '));
                    }
                }
            }
            
            if (hasSpellcastingEn) {
                for (const sc of data.en.spellcasting) {
                    if (sc.spells && Array.isArray(sc.spells)) {
                        console.log('  en.spells 已转换为数组格式:');
                        console.log('    ', JSON.stringify(sc.spells.slice(0, 3), null, 2).split('\n').join('\n    '));
                    }
                    if (sc.daily && Array.isArray(sc.daily)) {
                        console.log('  en.daily 已转换为数组格式:');
                        console.log('    ', JSON.stringify(sc.daily.slice(0, 3), null, 2).split('\n').join('\n    '));
                    }
                }
            }
            
            break; // 只显示第一个找到的
        }
    }
    
    if (!foundWithSpells) {
        console.log('未找到包含spellcasting字段的怪物文件');
    }
}

verifySpellcastingTransformation().catch(console.error);