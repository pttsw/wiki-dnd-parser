import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ESCAPE_MAP: Record<string, string> = {
  '_0_': '\\',
  '_1_': '/',
  '_2_': ':',
  '_3_': '*',
  '_4_': '"',
  '_5_': '<',
  '_6_': '>',
  '_7_': '-',
  '_8_': '?',
  '_9_': '-',
  '#': '_',
  '[': '_',
  ']': '_',
  '{': '_',
  '}': '_',
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePageTitle(rawTitle: string): string {
  let result = normalizeWhitespace(String(rawTitle || ''));
  
  const escapeKeys = Object.keys(ESCAPE_MAP).sort((a, b) => b.length - a.length);
  for (const key of escapeKeys) {
    result = result.split(key).join(ESCAPE_MAP[key]);
  }
  
  return result;
}

function derivePageTitleFromRelativePath(relativePath: string): string {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  const ext = path.extname(normalizedPath);
  const withoutExt = ext ? normalizedPath.slice(0, -ext.length) : normalizedPath;
  return normalizePageTitle(withoutExt);
}

function shouldExcludeFromParentPage(relativePath: string, excludePaths: string[] | null): boolean {
  if (!excludePaths || !Array.isArray(excludePaths)) {
    return false;
  }
  const normalizedRelPath = relativePath.replace(/\\/g, '/');
  return excludePaths.some(exclude => {
    const normalizedExclude = exclude.replace(/\\/g, '/');
    return normalizedRelPath.startsWith(normalizedExclude) || normalizedRelPath === normalizedExclude;
  });
}

function derivePageTitleWithParent(
  relativePath: string,
  options: { enableParentPage?: boolean; excludeParentPagePaths?: string[] | null } = {}
): string {
  const { enableParentPage = true, excludeParentPagePaths = null } = options;
  const normalizedPath = relativePath.replace(/\\/g, '/');
  
  if (enableParentPage) {
    const excluded = shouldExcludeFromParentPage(normalizedPath, excludeParentPagePaths);
    
    if (excluded) {
      let title = normalizedPath;
      const firstSlashIndex = title.indexOf('/');
      if (firstSlashIndex !== -1) {
        title = title.substring(firstSlashIndex + 1);
      }
      const ext = path.extname(title).toLowerCase();
      if (ext && ext !== '.json') {
        title = title.slice(0, -ext.length);
      }
      return normalizePageTitle(title);
    }
    
    const ext = path.extname(normalizedPath).toLowerCase();
    let title = normalizedPath;
    if (ext !== '.json') {
      title = ext ? normalizedPath.slice(0, -ext.length) : normalizedPath;
    }
    return normalizePageTitle(title);
  }
  
  return derivePageTitleFromRelativePath(relativePath);
}

const processFiles = async () => {
    const { default: XLSX } = await import('xlsx');
    
    const projectRoot = path.resolve(__dirname, '..');
    const outputDir = path.join(projectRoot, 'output');
    const outputPageDir = path.join(projectRoot, 'output_page');
    const wikiResults: { filePath: string; pageTitle: string; category: string }[] = [];
    const jsonResults: { filePath: string; pageTitle: string; category: string }[] = [];
    const seenWiki = new Set<string>();
    const seenJson = new Set<string>();

    const processDirectory = async (dir: string, baseDir: string, category: string) => {
        if (!fs.existsSync(dir)) {
            return;
        }

        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const absolutePath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, absolutePath);
            
            if (entry.isDirectory()) {
                await processDirectory(absolutePath, baseDir, category);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                
                if (ext === '.wiki') {
                    const pageTitle = derivePageTitleWithParent(relativePath, { enableParentPage: true });
                    
                    if (!seenWiki.has(pageTitle)) {
                        seenWiki.add(pageTitle);
                        wikiResults.push({
                            filePath: relativePath,
                            pageTitle,
                            category
                        });
                    }
                } else if (ext === '.json') {
                    const titleWithoutPrefix = derivePageTitleWithParent(relativePath, { enableParentPage: true });
                    const pageTitle = normalizePageTitle(`Data:${titleWithoutPrefix}`);
                    
                    if (!seenJson.has(pageTitle)) {
                        seenJson.add(pageTitle);
                        jsonResults.push({
                            filePath: relativePath,
                            pageTitle,
                            category
                        });
                    }
                }
            }
        }
    };

    await processDirectory(outputDir, outputDir, 'output');
    await processDirectory(outputPageDir, outputPageDir, 'output_page');

    wikiResults.sort((a, b) => a.pageTitle.localeCompare(b.pageTitle, 'zh-CN'));
    jsonResults.sort((a, b) => a.pageTitle.localeCompare(b.pageTitle, 'zh-CN'));

    await fs.promises.mkdir(outputDir, { recursive: true });

    const wikiSheet = XLSX.utils.aoa_to_sheet([
        ['页面标题', '文件路径', '来源目录'],
        ...wikiResults.map(item => [item.pageTitle, item.filePath, item.category])
    ]);
    const wikiWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wikiWorkbook, wikiSheet, '页面');
    XLSX.writeFile(wikiWorkbook, path.join(outputDir, 'file_list_page.xlsx'));

    const jsonSheet = XLSX.utils.aoa_to_sheet([
        ['JSON标题', '文件路径', '来源目录'],
        ...jsonResults.map(item => [item.pageTitle, item.filePath, item.category])
    ]);
    const jsonWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(jsonWorkbook, jsonSheet, 'JSON');
    XLSX.writeFile(jsonWorkbook, path.join(outputDir, 'file_list_json.xlsx'));
    
    console.log(`页面列表已输出到：${path.join(outputDir, 'file_list_page.xlsx')}`);
    console.log(`JSON列表已输出到：${path.join(outputDir, 'file_list_json.xlsx')}`);
    console.log(`页面: ${wikiResults.length} 个`);
    console.log(`JSON: ${jsonResults.length} 个`);
};

processFiles().catch(console.error);
