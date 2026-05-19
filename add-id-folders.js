const fs = require('fs').promises;
const path = require('path');

const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();

async function addIdFolders() {
  const categoryFolders = ['扩展', '模组'];
  
  for (const category of categoryFolders) {
    const categoryPath = path.join('./output_page', category);
    try {
      const bookFolders = await fs.readdir(categoryPath);
      
      for (const bookFolder of bookFolders) {
        const bookPath = path.join(categoryPath, bookFolder);
        const stat = await fs.stat(bookPath);
        if (!stat.isDirectory()) continue;
        
        // 获取书籍 ID（需要从其他地方获取）
        // 先尝试从 bookIdMap 获取，如果没有则使用文件夹名
        let bookId = bookFolder;
        
        // 创建 ID 文件夹
        const idDir = path.join(categoryPath, bookId);
        
        // 读取当前文件夹中的所有 .wiki 文件
        const files = await fs.readdir(bookPath);
        
        for (const file of files) {
          if (!file.endsWith('.wiki')) continue;
          
          // 读取文件内容，获取页面 ID
          const filePath = path.join(bookPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const match = content.match(/\{\{内容\|(\w+)\|(\w+)\|/);
          if (match) {
            const pageId = match[1];
            const bookIdFromContent = match[2];
            
            // 使用内容中的 bookId
            bookId = bookIdFromContent;
            
            // 构建重定向内容
            const escapedFileName = file.replace(/_1_/g, '/').replace('.wiki', '');
            const redirectTarget = `${category}/${sanitize(bookFolder)}/${escapedFileName}`;
            const redirectContent = `#重定向[[${redirectTarget}]]\n`;
            
            // 确保 ID 文件夹存在
            const idDir = path.join(categoryPath, bookId);
            await fs.mkdir(idDir, { recursive: true });
            
            // 写入重定向文件
            const idFilePath = path.join(idDir, `${pageId}.wiki`);
            await fs.writeFile(idFilePath, redirectContent, 'utf-8');
          }
        }
      }
    } catch (e) {
      console.log('Error processing', category, e.message);
    }
  }
  console.log('Done!');
}

addIdFolders();