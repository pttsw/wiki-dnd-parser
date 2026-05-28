
const fs = require('fs').promises;
const path = require('path');

async function test() {
    try {
        const srcPath = path.join('config', 'contents', 'XDMG.json');
        console.log('Reading', srcPath);
        let content = await fs.readFile(srcPath, 'utf-8');
        
        // 去掉 BOM
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        
        const obj = JSON.parse(content);
        console.log('Parsed successfully');
        console.log('Root has name/zh_name?', !!obj.name || !!obj.zh_name);
        console.log('Root has displayName?', !!obj.displayName);
        
        // 转换根级别
        if (obj.zh_name || obj.name) {
            obj.displayName = {
                zh: obj.zh_name || obj.name,
                en: obj.name
            };
            delete obj.zh_name;
            delete obj.name;
        }
        
        // 递归转换 contents 数组
        const convertContentArray = (arr) => {
            if (!Array.isArray(arr)) return arr;
            return arr.map(item => {
                const newItem = { ...item };
                
                // 转换 displayName
                if (newItem.zh_name || newItem.name) {
                    newItem.displayName = {
                        zh: newItem.zh_name || newItem.name,
                        en: newItem.name
                    };
                    delete newItem.zh_name;
                    delete newItem.name;
                }
                
                // 递归处理子 contents
                if (newItem.contents) {
                    newItem.contents = convertContentArray(newItem.contents);
                }
                
                // 递归处理 headers
                if (newItem.headers) {
                    newItem.headers = convertContentArray(newItem.headers);
                }
                
                return newItem;
            });
        };
        
        if (obj.contents) {
            obj.contents = convertContentArray(obj.contents);
        }
        
        console.log('Conversion successful');
        
        // 验证第一个 contents 元素
        if (obj.contents && obj.contents.length > 0) {
            console.log('First content has displayName?', !!obj.contents[0].displayName);
            console.log('First content displayName:', obj.contents[0].displayName);
            
            if (obj.contents[0].headers && obj.contents[0].headers.length > 0) {
                console.log('First header has displayName?', !!obj.contents[0].headers[0].displayName);
            }
        }
        
        // 写个测试文件
        await fs.writeFile('test-output.json', JSON.stringify(obj, null, 4), 'utf-8');
        console.log('Wrote test output to test-output.json');
        
    } catch (e) {
        console.error('Error:', e);
        console.error(e.stack);
    }
}

test();
