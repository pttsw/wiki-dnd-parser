
import * as fs from 'fs/promises';
import * as path from 'path';

console.log('Test started...');

try {
    const booksDir = './output/book';
    const bookDirs = await fs.readdir(booksDir);
    console.log('Found book dirs:', bookDirs.length);
    
    for (const bookDirName of bookDirs.slice(0, 1)) {
        const bookDir = path.join(booksDir, bookDirName);
        const stat = await fs.stat(bookDir);
        if (stat.isDirectory()) {
            console.log('Processing book:', bookDirName);
            const files = await fs.readdir(bookDir);
            console.log('  Files:', files.length);
            
            for (const file of files.slice(0, 2)) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(bookDir, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    const pageData = JSON.parse(content);
                    console.log('  Page:', pageData.id);
                }
            }
        }
    }
    
    console.log('Test completed successfully!');
} catch (error) {
    console.error('Error:', error);
    console.error('Stack:', error.stack);
}
