import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const processFiles = async () => {
    const { default: XLSX } = await import('xlsx');
    
    const projectRoot = path.resolve(__dirname, '..');
    const outputDir = path.join(projectRoot, 'output');
    const outputPageDir = path.join(projectRoot, 'output_page');
    const wikiResults: string[] = [];
    const jsonResults: string[] = [];
    const seenWiki = new Set<string>();
    const seenJson = new Set<string>();

    const processDirectory = async (dir: string) => {
        if (!fs.existsSync(dir)) {
            return;
        }

        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await processDirectory(path.join(dir, entry.name));
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                
                if (ext === '.wiki') {
                    let displayName = path.basename(entry.name, '.wiki');
                    displayName = displayName.replace(/_1_/g, '/');
                    
                    if (!seenWiki.has(displayName)) {
                        seenWiki.add(displayName);
                        wikiResults.push(displayName);
                    }
                } else if (ext === '.json') {
                    let displayName = `Data:${entry.name}`;
                    displayName = displayName.replace(/_1_/g, '/');
                    
                    if (!seenJson.has(displayName)) {
                        seenJson.add(displayName);
                        jsonResults.push(displayName);
                    }
                }
            }
        }
    };

    await processDirectory(outputDir);
    await processDirectory(outputPageDir);

    wikiResults.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    jsonResults.sort((a, b) => a.localeCompare(b, 'zh-CN'));

    await fs.promises.mkdir(outputDir, { recursive: true });

    const wikiSheet = XLSX.utils.aoa_to_sheet([['页面名'], ...wikiResults.map(name => [name])]);
    const wikiWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wikiWorkbook, wikiSheet, '页面');
    XLSX.writeFile(wikiWorkbook, path.join(outputDir, 'file_list_page.xlsx'));

    const jsonSheet = XLSX.utils.aoa_to_sheet([['JSON名'], ...jsonResults.map(name => [name])]);
    const jsonWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(jsonWorkbook, jsonSheet, 'JSON');
    XLSX.writeFile(jsonWorkbook, path.join(outputDir, 'file_list_json.xlsx'));
    
    console.log(`页面列表已输出到：${path.join(outputDir, 'file_list_page.xlsx')}`);
    console.log(`JSON列表已输出到：${path.join(outputDir, 'file_list_json.xlsx')}`);
    console.log(`页面: ${wikiResults.length} 个`);
    console.log(`JSON: ${jsonResults.length} 个`);
};

processFiles().catch(console.error);