import { promises as fs } from 'fs';
import path from 'path';
import config from './config.js';

const CN_GENERATED_DIR = path.join(config.DATA_ZH_DIR, 'generated');
const EN_GENERATED_DIR = path.join(config.DATA_EN_DIR, 'generated');
const OUTPUT_GENERATED_DIR = path.join('.', 'output', 'generated');

const listFilesRecursive = async (
    rootDir: string,
    relativeDir = ''
): Promise<string[]> => {
    const currentDir = path.join(rootDir, relativeDir);
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const relPath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            const nested = await listFilesRecursive(rootDir, relPath);
            files.push(...nested);
        } else if (entry.isFile()) {
            files.push(relPath);
        }
    }

    return files;
};

const ensureParentDir = async (filePath: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const getEnSuffixedPath = (relativePath: string): string => {
    const ext = path.extname(relativePath);
    if (!ext) return `${relativePath}_en`;
    return `${relativePath.slice(0, -ext.length)}_en${ext}`;
};

const run = async () => {
    await fs.access(CN_GENERATED_DIR);
    await fs.access(EN_GENERATED_DIR);

    await fs.rm(OUTPUT_GENERATED_DIR, { recursive: true, force: true });
    await fs.mkdir(OUTPUT_GENERATED_DIR, { recursive: true });

    const cnFiles = await listFilesRecursive(CN_GENERATED_DIR);
    let copiedCn = 0;
    let copiedEn = 0;
    let missingEn = 0;

    for (const relativePath of cnFiles) {
        const cnPath = path.join(CN_GENERATED_DIR, relativePath);
        const enPath = path.join(EN_GENERATED_DIR, relativePath);
        const cnOutPath = path.join(OUTPUT_GENERATED_DIR, relativePath);
        await ensureParentDir(cnOutPath);
        await fs.copyFile(cnPath, cnOutPath);
        copiedCn += 1;

        try {
            await fs.access(enPath);
            const enOutPath = path.join(OUTPUT_GENERATED_DIR, getEnSuffixedPath(relativePath));
            await ensureParentDir(enOutPath);
            await fs.copyFile(enPath, enOutPath);
            copiedEn += 1;
        } catch {
            missingEn += 1;
        }
    }

    console.log(
        `[mergeGenerated] 完成，CN文件=${copiedCn}，EN文件=${copiedEn}，缺失EN=${missingEn}，输出目录=${OUTPUT_GENERATED_DIR}`
    );
};

run().catch(error => {
    console.error('[mergeGenerated] 执行失败', error);
    process.exitCode = 1;
});
