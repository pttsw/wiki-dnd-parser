import fs from 'fs';
import path from 'path';

async function testRedDragonRedirect() {
    const outputDir = './output/bestiary';
    
    // 查找青年红龙的文件
    const files = fs.readdirSync(outputDir);
    const youngRedDragonFile = files.find(f => f.includes('青年红龙'));
    
    if (!youngRedDragonFile) {
        console.log('未找到青年红龙文件');
        return;
    }
    
    console.log(`找到青年红龙文件: ${youngRedDragonFile}`);
    
    // 检查重定向页面
    const wikiPagesDir = './output/wiki';
    if (!fs.existsSync(wikiPagesDir)) {
        console.log('wiki目录不存在');
        return;
    }
    
    const wikiFiles = fs.readdirSync(wikiPagesDir);
    const youngRedDragonWiki = wikiFiles.find(f => f.includes('青年红龙') && f.endsWith('.wik'));
    
    if (!youngRedDragonWiki) {
        console.log('未找到青年红龙wiki页面');
        return;
    }
    
    console.log(`找到青年红龙wiki页面: ${youngRedDragonWiki}`);
    
    const content = fs.readFileSync(path.join(wikiPagesDir, youngRedDragonWiki), 'utf-8');
    console.log('\n页面内容:');
    console.log(content);
    
    if (content.includes('#重定向 [[怪物/怪物手册（2014）/红龙#青年红龙]]')) {
        console.log('\n✓ 青年红龙正确重定向到红龙！');
    } else if (content.includes('#重定向 [[怪物/怪物手册（2014）/龙#青年红龙]]')) {
        console.log('\n✗ 青年红龙仍然错误重定向到龙！');
    } else {
        console.log('\n? 重定向格式未知');
    }
}

testRedDragonRedirect().catch(console.error);