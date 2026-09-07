import { execSync } from 'child_process';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { createUnzip } from 'zlib';
import config from './config.js';
import { resolveCopiesInBothDirectories, resolveCopiesInHomebrewDirectories } from './copyResolver.js';

// ==================== Homebrew 数据重组：全类别目录 ====================

/**
 * 数据键名 → 类别目录名的映射。
 * 未列出的键（如 card, citation, sense 等）无对应目录，保留在原文件中。
 * 
 * 重组逻辑：遍历所有目录下的 JSON 文件，检查每个键是否映射到其他目录。
 * 若键的目标目录与当前文件所在目录不同，则将数据移动到目标目录的对应文件中。
 * 解决 homebrew 数据中各类别目录下参杂其他类别数据的问题。
 */
const KEY_TO_DIR: Record<string, string> = {
    // 直接对应
    'action': 'action',
    'adventure': 'adventure',
    'adventureData': 'adventure',
    'background': 'background',
    'backgroundFluff': 'background',
    'baseitem': 'baseitem',
    'book': 'book',
    'bookData': 'book',
    'boon': 'boon',
    'charoption': 'charoption',
    'class': 'class',
    'classFeature': 'class',
    'classFluff': 'class',
    'condition': 'condition',
    'conditionFluff': 'condition',
    'cult': 'cult',
    'deck': 'deck',
    'deity': 'deity',
    'disease': 'disease',
    'diseaseFluff': 'disease',
    'encounter': 'encounter',
    'encounterData': 'encounter',
    'feat': 'feat',
    'featFluff': 'feat',
    'hazard': 'hazard',
    'item': 'item',
    'itemEntry': 'item',
    'itemFluff': 'item',
    'itemGroup': 'item',
    'itemMastery': 'item',
    'itemProperty': 'item',
    'itemType': 'item',
    'itemTypeAdditionalEntries': 'item',
    'language': 'language',
    'languageFluff': 'language',
    'legendaryGroup': 'creature',
    'magicvariant': 'magicvariant',
    'makebrewCreatureTrait': 'makebrew',
    'monster': 'creature',
    'monsterFluff': 'creature',
    'object': 'object',
    'objectFluff': 'object',
    'optionalfeature': 'optionalfeature',
    'optionalfeatureFluff': 'optionalfeature',
    'race': 'race',
    'raceFluff': 'race',
    'recipe': 'recipe',
    'recipeFluff': 'recipe',
    'reward': 'reward',
    'rewardFluff': 'reward',
    'spell': 'spell',
    'spellFluff': 'spell',
    'subclass': 'subclass',
    'subclassFeature': 'subclass',
    'subclassFluff': 'subclass',
    'subrace': 'subrace',
    'table': 'table',
    'trap': 'trap',
    'variantrule': 'variantrule',
    'vehicle': 'vehicle',
    'vehicleFluff': 'vehicle',
    'vehicleUpgrade': 'vehicle',
};

/**
 * 全类别数据重组：遍历 homebrew 所有类别目录下的 JSON 文件，
 * 将其中不属于当前目录的数组数据剪切到正确的类别目录。
 * 
 * 覆盖所有类别目录（action, background, class, creature, spell, item, race,
 * subrace, table, trap, variantrule, vehicle, encounter, feat, language,
 * optionalfeature, subclass 等），不仅限于 collection 目录。
 * 
 * 解决 homebrew 数据中各类别目录下参杂其他类别数据的问题，
 * 确保每个类别目录下只包含该类型的数据。
 * 
 * @param homebrewDir homebrew 根目录（en 或 zh）
 */
const reorganizeAllHomebrewData = async (homebrewDir: string): Promise<void> => {
    // 扫描所有子目录
    let dirNames: string[];
    try {
        const entries = await fs.readdir(homebrewDir, { withFileTypes: true });
        dirNames = entries.filter((e: any) => e.isDirectory()).map((e: any) => e.name);
    } catch {
        console.log(`[${getTimestamp()}] homebrew 目录不存在，跳过重组: ${homebrewDir}`);
        return;
    }

    if (dirNames.length === 0) {
        console.log(`[${getTimestamp()}] 无子目录，跳过重组: ${homebrewDir}`);
        return;
    }

    // 收集所有目录下的 JSON 文件: { filePath, dirName, fileName, data }
    const allFiles: any[] = [];

    for (const dir of dirNames) {
        const dirPath = path.join(homebrewDir, dir);
        let files: string[];
        try {
            files = await fs.readdir(dirPath);
        } catch {
            continue;
        }

        const jsonFiles = files.filter((f: string) => f.endsWith('.json'));
        for (const file of jsonFiles) {
            const filePath = path.join(dirPath, file);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const data = JSON.parse(content);
                allFiles.push({ filePath, dirName: dir, fileName: file, data });
            } catch {
                // 跳过不可读的文件
            }
        }
    }

    // 第一遍扫描：收集需要移动的键
    const moves: Array<{ source: any; targetDir: string; key: string; array: any[] }> = [];
    const keysToRemove = new Map<any, string[]>();

    for (const fileData of allFiles) {
        const { data, dirName } = fileData;
        const keys = Object.keys(data);

        for (const key of keys) {
            // 跳过元数据、特殊键名和非数组
            if (key.startsWith('_') || key.startsWith('$') || key.startsWith('foundry')) continue;
            if (!Array.isArray(data[key])) continue;
            if (data[key].length === 0) continue;

            const targetDir = KEY_TO_DIR[key];
            if (!targetDir) continue;           // 无对应目录，保留在原位
            if (targetDir === dirName) continue; // 已在正确目录，跳过

            // 需要移动此键的数据到目标目录
            moves.push({ source: fileData, targetDir, key, array: data[key] });
            if (!keysToRemove.has(fileData)) keysToRemove.set(fileData, []);
            keysToRemove.get(fileData)!.push(key);
        }
    }

    if (moves.length === 0) {
        console.log(`[${getTimestamp()}] 所有数据已在正确目录，无需重组 (${homebrewDir})`);
        return;
    }

    // 按目标 (targetDir, fileName) 分组，以便合并到同一文件
    const movesByTarget = new Map<string, Array<{ key: string; array: any[] }>>();

    for (const move of moves) {
        const targetKey = `${move.targetDir}/${move.source.fileName}`;
        if (!movesByTarget.has(targetKey)) {
            movesByTarget.set(targetKey, []);
        }
        movesByTarget.get(targetKey)!.push({ key: move.key, array: move.array });
    }

    // 写入目标文件（合并已有数据）
    for (const [targetKey, keyArrays] of movesByTarget) {
        const [targetDir, ...fileNameParts] = targetKey.split('/');
        const fileName = fileNameParts.join('/');
        const targetDirPath = path.join(homebrewDir, targetDir);
        const targetFilePath = path.join(targetDirPath, fileName);

        await fs.mkdir(targetDirPath, { recursive: true });

        let targetData: any = {};
        try {
            const existingContent = await fs.readFile(targetFilePath, 'utf-8');
            targetData = JSON.parse(existingContent);
        } catch {
            // 目标文件不存在，使用空对象
        }

        for (const { key, array } of keyArrays) {
            if (Array.isArray(targetData[key])) {
                targetData[key].push(...array);
            } else {
                targetData[key] = array;
            }
        }

        await fs.writeFile(targetFilePath, JSON.stringify(targetData, null, 2), 'utf-8');
    }

    // 从源文件中删除已移动的键
    for (const [fileData, keys] of keysToRemove) {
        for (const key of keys) {
            delete fileData.data[key];
        }
        await fs.writeFile(fileData.filePath, JSON.stringify(fileData.data, null, 2), 'utf-8');
    }

    const totalMoved = moves.reduce((sum, m) => sum + m.array.length, 0);
    const sourceDirs = [...new Set(moves.map(m => m.source.dirName))];
    const targetDirs = [...new Set(moves.map(m => m.targetDir))];
    console.log(`[${getTimestamp()}] 全类别数据重组完成: 扫描 ${dirNames.length} 个目录，` +
        `从 ${sourceDirs.join(', ')} 移动 ${moves.length} 个键 ` +
        `到 ${targetDirs.join(', ')}，共 ${totalMoved} 条数据`);
};

interface ChangedArray {
    name: string;
    type: 'added' | 'modified' | 'removed';
    count?: number;
    changedUids?: string[];
    addedUids?: string[];
    removedUids?: string[];
}

interface ChangedFile {
    filePath: string;
    locale: 'zh' | 'en';
    status: 'added' | 'modified' | 'deleted';
    changedArrays: ChangedArray[];
}

interface CommitInfo {
    hash: string;
    message: string;
    author: string;
    date: string;
}

const getItemUid = (item: any, arrayName: string): string | null => {
    if (!item || typeof item !== 'object') return null;
    
    if (item.id !== undefined) {
        return String(item.id);
    }
    
    const nameField = item.ENG_name || item.name;
    const sourceField = item.source;
    if (nameField && sourceField) {
        return `${String(nameField).trim()}|${String(sourceField)}`;
    }
    
    if (nameField && item.page !== undefined) {
        return `${String(nameField).trim()}|${item.page}`;
    }
    
    if (item.name && item.abbreviation) {
        return `${String(item.name).trim()}|${String(item.abbreviation)}`;
    }
    
    return null;
};

const analyzeJsonDiff = (oldContent: string, newContent: string): ChangedArray[] => {
    const changedArrays: ChangedArray[] = [];
    try {
        const oldJson = JSON.parse(oldContent);
        const newJson = JSON.parse(newContent);
        
        const compareArrays = (oldArr: any[], newArr: any[], arrayName: string): ChangedArray | null => {
            const oldUidMap = new Map<string, any>();
            const newUidMap = new Map<string, any>();
            const oldNoUid: any[] = [];
            const newNoUid: any[] = [];
            
            for (const item of oldArr) {
                const uid = getItemUid(item, arrayName);
                if (uid !== null) {
                    oldUidMap.set(uid, item);
                } else {
                    oldNoUid.push(item);
                }
            }
            
            for (const item of newArr) {
                const uid = getItemUid(item, arrayName);
                if (uid !== null) {
                    newUidMap.set(uid, item);
                } else {
                    newNoUid.push(item);
                }
            }
            
            const addedUids: string[] = [];
            const removedUids: string[] = [];
            const modifiedUids: string[] = [];
            
            for (const [uid, newItem] of newUidMap) {
                if (!oldUidMap.has(uid)) {
                    addedUids.push(uid);
                } else {
                    const oldItem = oldUidMap.get(uid);
                    if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
                        modifiedUids.push(uid);
                    }
                }
            }
            
            for (const [uid] of oldUidMap) {
                if (!newUidMap.has(uid)) {
                    removedUids.push(uid);
                }
            }
            
            const noUidChanged = JSON.stringify(oldNoUid) !== JSON.stringify(newNoUid);
            
            if (addedUids.length === 0 && removedUids.length === 0 && modifiedUids.length === 0 && !noUidChanged) {
                return null;
            }
            
            let type: 'added' | 'modified' | 'removed' = 'modified';
            const countDiff = newArr.length - oldArr.length;
            if (countDiff > 0 && modifiedUids.length === 0 && removedUids.length === 0) {
                type = 'added';
            } else if (countDiff < 0 && modifiedUids.length === 0 && addedUids.length === 0) {
                type = 'removed';
            }
            
            const result: ChangedArray = {
                name: arrayName,
                type,
                count: newArr.length
            };
            
            if (addedUids.length > 0) {
                result.addedUids = addedUids;
            }
            if (removedUids.length > 0) {
                result.removedUids = removedUids;
            }
            if (modifiedUids.length > 0) {
                result.changedUids = modifiedUids;
            }
            
            return result;
        };
        
        const compareObjects = (obj1: any, obj2: any, prefix: string = '') => {
            const keys1 = new Set(Object.keys(obj1));
            const keys2 = new Set(Object.keys(obj2));
            
            for (const key of keys2) {
                const fullKey = prefix ? `${prefix}.${key}` : key;
                const val1 = obj1[key];
                const val2 = obj2[key];
                
                if (Array.isArray(val2)) {
                    if (Array.isArray(val1)) {
                        const diffResult = compareArrays(val1, val2, fullKey);
                        if (diffResult) {
                            changedArrays.push(diffResult);
                        }
                    } else {
                        const uids: string[] = [];
                        for (const item of val2) {
                            const uid = getItemUid(item, fullKey);
                            if (uid !== null) uids.push(uid);
                        }
                        changedArrays.push({
                            name: fullKey,
                            type: 'added',
                            count: val2.length,
                            addedUids: uids.length > 0 ? uids : undefined
                        });
                    }
                } else if (typeof val2 === 'object' && val2 !== null && !Array.isArray(val2) && key !== '_meta') {
                    compareObjects(val1 || {}, val2, fullKey);
                }
            }
            
            for (const key of keys1) {
                const fullKey = prefix ? `${prefix}.${key}` : key;
                if (!keys2.has(key)) {
                    const val1 = obj1[key];
                    if (Array.isArray(val1)) {
                        const uids: string[] = [];
                        for (const item of val1) {
                            const uid = getItemUid(item, fullKey);
                            if (uid !== null) uids.push(uid);
                        }
                        changedArrays.push({
                            name: fullKey,
                            type: 'removed',
                            count: 0,
                            removedUids: uids.length > 0 ? uids : undefined
                        });
                    }
                }
            }
        };
        
        compareObjects(oldJson, newJson);
    } catch {
        changedArrays.push({
            name: 'content',
            type: 'modified'
        });
    }
    
    return changedArrays;
};

const getCommitInfo = (commitHash: string, repoDir: string): CommitInfo => {
    try {
        // -s / --no-patch: 只输出 commit 元信息，不输出 patch（blobless clone 下 patch 会触发网络拉取所有 blob）
        const result = execSync(`git show -s ${commitHash} --format='%H||%s||%an||%ad' --date=iso-strict`, {
            cwd: repoDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        
        const [hash, message, author, date] = result.split('||');
        return {
            hash: hash.trim(),
            message: message.trim(),
            author: author.trim(),
            date: date.trim()
        };
    } catch {
        return {
            hash: commitHash,
            message: 'Unknown',
            author: 'Unknown',
            date: 'Unknown'
        };
    }
};

const getCommonParentDir = (path1: string, path2: string): string => {
    const dir1 = path.dirname(path1);
    const dir2 = path.dirname(path2);
    const parts1 = dir1.split(/[\\/]/);
    const parts2 = dir2.split(/[\\/]/);
    const commonParts: string[] = [];
    const minLength = Math.min(parts1.length, parts2.length);
    for (let i = 0; i < minLength; i++) {
        if (parts1[i] === parts2[i]) {
            commonParts.push(parts1[i]);
        } else {
            break;
        }
    }
    return commonParts.length > 0 ? commonParts.join('/') : dir1;
};

const generateReplaceLogs = async (repoDir: string, zhDir: string, enDir: string) => {
    const replaceLogs: {
        commit: CommitInfo;
        previousCommit: CommitInfo;
        changedFiles: ChangedFile[];
        generatedAt: string;
    } = {
        commit: { hash: '', message: '', author: '', date: '' },
        previousCommit: { hash: '', message: '', author: '', date: '' },
        changedFiles: [],
        generatedAt: new Date().toISOString()
    };
    
    try {
        const latestCommit = execSync('git rev-parse HEAD', {
            cwd: repoDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        
        replaceLogs.commit = getCommitInfo(latestCommit, repoDir);
        
        let previousCommit = '';
        try {
            previousCommit = execSync('git rev-parse HEAD~1', {
                cwd: repoDir,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
        } catch {
            console.log(`[${getTimestamp()}]   depth=1，跳过 previous commit 对比`);
        }
        
        if (previousCommit) {
            replaceLogs.previousCommit = getCommitInfo(previousCommit, repoDir);
            
            const diffOutput = execSync(`git diff ${previousCommit} ${latestCommit} --name-status`, {
                cwd: repoDir,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore']
            });
            
            const lines = diffOutput.trim().split('\n');
            
            for (const line of lines) {
                const [status, filePath] = line.split('\t');
                if (!filePath) continue;
                
                const jsonMatch = filePath.match(/(data|data-bak)\/(.+\.json)/);
                if (!jsonMatch) continue;
                
                const locale = jsonMatch[1] === 'data' ? 'zh' : 'en';
                
                let changedArrays: ChangedArray[] = [];
                
                if (status !== 'D') {
                    try {
                        const newContent = await fs.readFile(path.join(repoDir, filePath), 'utf-8');
                        let oldContent = '';
                        if (status !== 'A') {
                            try {
                                oldContent = execSync(`git show ${previousCommit}:${filePath}`, {
                                    cwd: repoDir,
                                    encoding: 'utf-8',
                                    stdio: ['ignore', 'pipe', 'ignore']
                                }).trim();
                            } catch {
                                oldContent = '';
                            }
                        }
                        const changedArraysResult = analyzeJsonDiff(oldContent, newContent);
                        changedArrays = changedArraysResult;
                    } catch {
                        changedArrays = [{ name: 'content', type: 'modified' }];
                    }
                }
                
                let fileStatus: 'added' | 'modified' | 'deleted' = 'modified';
                if (status === 'A') fileStatus = 'added';
                if (status === 'D') fileStatus = 'deleted';
                
                replaceLogs.changedFiles.push({
                    filePath: jsonMatch[2],
                    locale,
                    status: fileStatus,
                    changedArrays
                });
            }
        } else {
            console.log(`[${getTimestamp()}]   depth=1，无法计算 diff，跳过变更文件列表`);
        }
    } catch (error) {
        console.warn(`[${getTimestamp()}] 生成 replace-logs.json 失败:`, error);
    }
    
    const commonParentDir = getCommonParentDir(zhDir, enDir);
    const outputPath = path.join(commonParentDir, 'replace-logs.json');
    await fs.mkdir(commonParentDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(replaceLogs, null, 2), 'utf-8');
    console.log(`[${getTimestamp()}] 已生成 replace-logs.json: ${outputPath}`);
};

const getTimestamp = () => {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // HH:MM:SS
};

type ProxyConfig = {
    http?: string;
    https?: string;
    all?: string;
};

const parseProxyServerValue = (value: string): ProxyConfig => {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if (!trimmed.includes('=')) {
        return { http: trimmed, https: trimmed };
    }
    const result: ProxyConfig = {};
    for (const part of trimmed.split(';')) {
        const [rawKey, rawValue] = part.split('=');
        const key = rawKey?.trim().toLowerCase();
        const proxyValue = rawValue?.trim();
        if (!key || !proxyValue) continue;
        if (key === 'http') result.http = proxyValue;
        else if (key === 'https') result.https = proxyValue;
        else if (key.startsWith('socks')) result.all = proxyValue;
    }
    return result;
};

const readGitProxy = (key: string): string | undefined => {
    try {
        const value = execSync(`git config --global --get ${key}`, {
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf-8',
        })
            .toString()
            .trim();
        return value || undefined;
    } catch {
        return undefined;
    }
};

const readWinInetProxy = (): ProxyConfig | undefined => {
    if (process.platform !== 'win32') return undefined;
    try {
        const output = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /v ProxyServer /v AutoConfigURL',
            {
                stdio: ['ignore', 'pipe', 'ignore'],
                encoding: 'utf-8',
            }
        ).toString();
        const enableMatch = output.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
        const enabled = enableMatch ? parseInt(enableMatch[1], 16) !== 0 : false;
        if (!enabled) return undefined;
        const serverMatch = output.match(/ProxyServer\s+REG_SZ\s+(.+)/);
        if (!serverMatch) return undefined;
        return parseProxyServerValue(serverMatch[1]);
    } catch {
        return undefined;
    }
};

const readWinHttpProxy = (): ProxyConfig | undefined => {
    if (process.platform !== 'win32') return undefined;
    try {
        const output = execSync('netsh winhttp show proxy', {
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf-8',
        }).toString();
        if (/Direct access/i.test(output)) return undefined;
        const serverMatch = output.match(/Proxy Server\(s\)\s*:\s*(.+)/i);
        if (!serverMatch) return undefined;
        return parseProxyServerValue(serverMatch[1]);
    } catch {
        return undefined;
    }
};

const mergeProxy = (base: ProxyConfig, fallback: ProxyConfig): ProxyConfig => ({
    http: base.http ?? fallback.http,
    https: base.https ?? fallback.https,
    all: base.all ?? fallback.all,
});

const buildProxyEnv = () => {
    const env = { ...process.env };
    const envProxy: ProxyConfig = {
        http: env.HTTP_PROXY || env.http_proxy,
        https: env.HTTPS_PROXY || env.https_proxy,
        all: env.ALL_PROXY || env.all_proxy,
    };
    const gitProxy: ProxyConfig = {
        http: readGitProxy('http.proxy'),
        https: readGitProxy('https.proxy'),
    };
    const winInetProxy = readWinInetProxy();
    const winHttpProxy = readWinHttpProxy();
    const winProxy = mergeProxy(winInetProxy ?? {}, winHttpProxy ?? {});
    const merged = mergeProxy(envProxy, mergeProxy(gitProxy, winProxy));

    const sources: string[] = [];
    if (envProxy.http || envProxy.https || envProxy.all) sources.push('env');
    if (gitProxy.http || gitProxy.https) sources.push('git');
    if (winInetProxy?.http || winInetProxy?.https || winInetProxy?.all) sources.push('wininet');
    if (winHttpProxy?.http || winHttpProxy?.https || winHttpProxy?.all) sources.push('winhttp');

    if (merged.http) {
        env.HTTP_PROXY = merged.http;
        env.http_proxy = merged.http;
    }
    if (merged.https) {
        env.HTTPS_PROXY = merged.https;
        env.https_proxy = merged.https;
    }
    if (merged.all) {
        env.ALL_PROXY = merged.all;
        env.all_proxy = merged.all;
    }

    return { env, sources };
};

/**
 * 克隆单个仓库，将指定子目录复制到目标路径。
 */
const cloneAndCopy = async (
    repoUrl: string,
    tempDir: string,
    subdirMappings: { source: string; target: string }[],
    execOptions: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
    branch?: string,
    onBeforeCleanup?: (tempDir: string) => Promise<void>
) => {
    console.log(`[${getTimestamp()}] 正在克隆仓库: ${repoUrl}`);
    
    // 清理临时目录
    const safeRmdir = async (dir: string, retries = 3) => {
        try {
            execSync(`taskkill /f /im git.exe 2>nul`, { stdio: 'pipe' });
        } catch {}
        for (let i = 0; i < retries; i++) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                return true;
            } catch (err: any) {
                if ((err.code === 'EBUSY' || err.code === 'ENOENT') && i < retries - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                } else if (err.code !== 'ENOENT') {
                    throw err;
                } else {
                    return true;
                }
            }
        }
        return false;
    };
    
    await safeRmdir(tempDir);
    
    // 克隆仓库
    const cloneArgs = [
        'clone',
        '--depth',
        '1',
        ...(branch ? ['--branch', branch] : []),
        repoUrl,
        tempDir,
    ];
    console.log(`[${getTimestamp()}] 执行: git ${cloneArgs.join(' ')}`);
    execSync(`git ${cloneArgs.join(' ')} 2>&1`, { stdio: 'pipe', env: execOptions.env, timeout: 600000 });
    console.log(`[${getTimestamp()}] 克隆完成！`);
    
    // fetch 额外 commit 用于 diff
    console.log(`[${getTimestamp()}] 获取额外 commit 用于 diff 对比...`);
    execSync(`git -C ${tempDir} fetch --depth 2 2>&1`, { stdio: 'pipe', env: execOptions.env, timeout: 600000 });
    console.log(`[${getTimestamp()}] 获取完成！`);
    
    // 验证仓库完整性
    console.log(`[${getTimestamp()}] 验证仓库完整性...`);
    try {
        const headCommit = execSync(`git -C ${tempDir} rev-parse HEAD 2>&1`, { stdio: 'pipe' });
        console.log(`[${getTimestamp()}] HEAD: ${headCommit.toString().trim()}`);
    } catch (e) {
        console.error(`[${getTimestamp()}] 仓库不完整，尝试修复...`);
        await safeRmdir(tempDir);
        execSync(`git ${cloneArgs.join(' ')} 2>&1`, { stdio: 'pipe', env: execOptions.env, timeout: 600000 });
    }
    console.log(`[${getTimestamp()}] 仓库验证通过！`);
    
    // 复制子目录到目标路径
    for (const mapping of subdirMappings) {
        const sourcePath = path.join(tempDir, mapping.source);
        const targetPath = mapping.target;
        const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
        
        if (sourceExists) {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.rm(targetPath, { recursive: true, force: true });
            await fs.cp(sourcePath, targetPath, { recursive: true });
            console.log(`[${getTimestamp()}]   复制 ${mapping.source} → ${targetPath}`);
        } else {
            console.warn(`[${getTimestamp()}] 警告: 找不到源目录 ${sourcePath}`);
        }
    }
    
    // 清理前的回调（如生成 replace-logs）
    if (onBeforeCleanup) {
        await onBeforeCleanup(tempDir);
    }
    
    // 清理临时目录
    try {
        await safeRmdir(tempDir);
        console.log(`[${getTimestamp()}] 临时目录已清理`);
    } catch (rmErr) {
        console.warn(`[${getTimestamp()}] 警告: 无法清理临时目录 ${tempDir}，忽略错误继续执行...`);
    }
};

/**
 * 分别克隆中英文仓库，将数据复制到目标路径。
 * @param zhRepoUrl 中文数据仓库地址
 * @param enRepoUrl 英文数据仓库地址（含 data 和 js）
 * @param targetPaths 目标路径，例如 { zh: '<DATA_ZH_DIR父目录>', en: '<DATA_EN_DIR父目录>' }
 * @param branch 分支名（可选），默认使用仓库默认分支
 */
const getRepoData = async (
    zhRepoUrl: string,
    enRepoUrl: string,
    targetPaths: { zh: string; en: string },
    branch?: string
) => {
    const branchText = branch ? ` (分支: ${branch})` : '';
    const proxy = buildProxyEnv();
    if (proxy.sources.length > 0) {
        console.log(
            `[${getTimestamp()}] 检测到代理来源(${proxy.sources.join(
                '+'
            )})，优先级 env > git > windows`
        );
    }
    const execOptions = { stdio: 'inherit' as const, env: proxy.env };

    try {
        // 1. 克隆中文仓库（tjliqy/mirror）→ data/ → input/5e-cn/data
        console.log(`[${getTimestamp()}] === 克隆中文数据仓库 ===`);
        await cloneAndCopy(
            zhRepoUrl,
            './temp-git-clone-zh',
            [{ source: 'data', target: path.join(targetPaths.zh, 'data') }],
            execOptions,
            branch,
            // 清理前生成 replace-logs.json
            async (tempDir: string) => {
                console.log(`[${getTimestamp()}] 生成 replace-logs.json...`);
                await generateReplaceLogs(tempDir, config.DATA_ZH_DIR, config.DATA_EN_DIR);
            }
        );
        
        // 2. 克隆英文仓库（5etools-src）→ data/ → input/5e-en/data, js/ → input/5e-en/js
        console.log(`[${getTimestamp()}] === 克隆英文数据仓库 ===`);
        await cloneAndCopy(
            enRepoUrl,
            './temp-git-clone-en',
            [
                { source: 'data', target: path.join(targetPaths.en, 'data') },
                { source: 'js', target: path.join(targetPaths.en, 'js') },
            ],
            execOptions,
            branch
        );
        
        // 验证关键文件是否存在
        const zhTargetPath = path.join(targetPaths.zh, 'data');
        const enTargetPath = path.join(targetPaths.en, 'data');
        const zhBooksPath = path.join(zhTargetPath, 'books.json');
        const enBooksPath = path.join(enTargetPath, 'books.json');
        const zhBooksExists = await fs.access(zhBooksPath).then(() => true).catch(() => false);
        const enBooksExists = await fs.access(enBooksPath).then(() => true).catch(() => false);
        
        if (zhBooksExists && enBooksExists) {
            console.log(`[${getTimestamp()}] 数据克隆成功: zh=${zhTargetPath}, en=${enTargetPath}`);
        } else {
            console.warn(`[${getTimestamp()}] 警告: 部分关键文件缺失 - zh/books.json: ${zhBooksExists}, en/books.json: ${enBooksExists}`);
        }
    } catch (error) {
        // 即使克隆过程出错，也尝试处理 _copy
        console.error(`[${getTimestamp()}] 克隆过程中出错: ${error}`);
        console.log(`[${getTimestamp()}] 继续尝试处理 _copy...`);
    }
};

/**
 * 为 homebrew 仓库生成 replace-logs。
 * 分别处理英文和中文 homebrew 仓库，合并输出到 replace-logs-homebrew.json。
 */
const generateHomebrewReplaceLogs = async (
    enRepoDir: string,
    zhRepoDir: string,
    outputPath: string
) => {
    const processRepo = async (repoDir: string, locale: 'en' | 'zh') => {
        const result = {
            commit: { hash: '', message: '', author: '', date: '' } as CommitInfo,
            previousCommit: { hash: '', message: '', author: '', date: '' } as CommitInfo,
            changedFiles: [] as ChangedFile[],
            generatedAt: new Date().toISOString()
        };

        try {
            console.log(`[${getTimestamp()}]   [${locale}] 读取 commit 信息...`);
            const latestCommit = execSync('git rev-parse HEAD', {
                cwd: repoDir,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();

            let previousCommit = '';
            try {
                previousCommit = execSync('git rev-parse HEAD~1', {
                    cwd: repoDir,
                    encoding: 'utf-8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim();
            } catch {
                console.log(`[${getTimestamp()}]   [${locale}] 仓库 depth=1，跳过 previous commit 对比`);
            }

            result.commit = getCommitInfo(latestCommit, repoDir);
            if (previousCommit) {
                result.previousCommit = getCommitInfo(previousCommit, repoDir);
            }

            if (previousCommit) {
                console.log(`[${getTimestamp()}]   [${locale}] 计算 diff...`);
                const diffOutput = execSync(`git diff ${previousCommit} ${latestCommit} --name-status`, {
                    cwd: repoDir,
                    encoding: 'utf-8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });

                const lines = diffOutput.trim().split('\n');
                for (const line of lines) {
                    const [status, filePath] = line.split('\t');
                    if (!filePath) continue;

                    const jsonMatch = filePath.match(/(.+\.json)$/);
                    if (!jsonMatch) continue;

                    // blobless clone 下跳过逐文件内容比对（避免逐个网络拉取旧版 blob）
                    let fileStatus: 'added' | 'modified' | 'deleted' = 'modified';
                    if (status === 'A') fileStatus = 'added';
                    if (status === 'D') fileStatus = 'deleted';

                    result.changedFiles.push({
                        filePath: jsonMatch[1],
                        locale,
                        status: fileStatus,
                        changedArrays: []
                    });
                }
            }
            console.log(`[${getTimestamp()}]   [${locale}] 完成，变更文件数: ${result.changedFiles.length}`);
        } catch (error) {
            console.warn(`[${getTimestamp()}] 生成 homebrew replace-logs 失败 (${locale}):`, error);
        }

        return result;
    };

    const [enResult, zhResult] = await Promise.all([
        processRepo(enRepoDir, 'en'),
        processRepo(zhRepoDir, 'zh')
    ]);

    const output = { en: enResult, zh: zhResult, generatedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`[${getTimestamp()}] 已生成 replace-logs-homebrew.json: ${outputPath}`);
};

const HOMEBREW_SPARSE_PATTERNS = [
    '*.json',
    '**/*.json',
];

/**
 * 检查目录是否包含有效的 homebrew JSON 数据。
 * 如果目录存在（即使为空），也视为有效，避免重复克隆。
 */
const hasValidHomebrewData = async (dir: string): Promise<boolean> => {
    try {
        await fs.access(dir);
        return true; // 目录存在即视为有效，避免重复克隆
    } catch {
        return false;
    }
};

const cloneHomebrewRepo = async (
    repoUrl: string,
    targetDir: string,
    execOptions: { stdio: 'inherit'; env: NodeJS.ProcessEnv }
) => {
    // 检查是否已有有效数据，如有则跳过克隆
    if (await hasValidHomebrewData(targetDir)) {
        console.log(`[${getTimestamp()}] ${targetDir} 已存在有效数据，跳过克隆`);
        return;
    }

    console.log(`[${getTimestamp()}] 正在克隆 homebrew 仓库: ${repoUrl}`);

    // 先清理 index.lock 和残留的 git 进程
    try {
        execSync(`taskkill /f /im git.exe 2>nul`, { stdio: 'pipe' });
    } catch {
        // 忽略清理失败
    }

    // 安全删除目标目录（忽略所有错误，包括权限问题）
    const safeRmdir = async (dir: string) => {
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch {
            // 回退方案：使用系统命令删除
            try {
                execSync(`rmdir /s /q "${dir}" 2>nul`, { stdio: 'pipe' });
            } catch {
                // 忽略所有错误
            }
        }
    };

    // 先清理旧的 index.lock 和残留的 git 进程
    try {
        execSync(`taskkill /f /im git.exe 2>nul`, { stdio: 'pipe' });
    } catch {
        // 忽略清理失败
    }

    await safeRmdir(targetDir);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    // 使用 --depth 1 浅克隆（不额外过滤，确保完整可用）
    // 设置 5 分钟超时，避免网络问题导致永久阻塞
    const cloneArgs = ['clone', '--depth', '1', repoUrl, targetDir];
    console.log(`[${getTimestamp()}] 执行: git ${cloneArgs.join(' ')}`);
    execSync(`git ${cloneArgs.join(' ')}`, {
        stdio: 'inherit',
        env: execOptions.env,
        cwd: path.dirname(targetDir),
        timeout: 300000, // 5 分钟超时
    });

    console.log(`[${getTimestamp()}] homebrew 仓库克隆完成: ${targetDir}`);
};

/**
 * 需要保留不合并的目录列表。
 * _generated 目录只有 5 个文件，且是系统自动生成的，无需合并。
 * 其他所有类别目录（adventure, book, class, creature, spell, subclass 等）
 * 均可安全合并为 _all.json，因为 loadHomebrewByKeys 和 loadAllHomebrewFiles
 * 都已支持优先读取 _all.json。
 */
const PER_PUBLICATION_CATEGORIES = new Set([
    '_generated',
]);

/**
 * 合并 homebrew 所有分类目录下的 JSON 文件为单个 _all.json 文件。
 * 将所有小文件合并为一个 _all.json，将数千个小文件读取减少到几十个，
 * 大幅加快后续 start:homebrew 的加载速度。
 */
const consolidateHomebrewData = async (homebrewDir: string): Promise<void> => {
    let dirNames: string[];
    try {
        const entries = await fs.readdir(homebrewDir, { withFileTypes: true });
        dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return;
    }

    let totalConsolidated = 0;
    let totalFiles = 0;

    for (const dir of dirNames) {
        if (PER_PUBLICATION_CATEGORIES.has(dir)) continue;

        const dirPath = path.join(homebrewDir, dir);
        let files: string[];
        try {
            files = await fs.readdir(dirPath);
        } catch {
            continue;
        }

        const jsonFiles = files.filter(f => f.endsWith('.json') && f !== '_all.json');
        if (jsonFiles.length <= 1) continue; // 只有一个文件，没必要合并

        // 读取所有文件，合并数组数据
        const merged: Record<string, any[]> = {};
        for (const file of jsonFiles) {
            try {
                const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
                const data = JSON.parse(content);
                for (const key of Object.keys(data)) {
                    if (key.startsWith('_') || key.startsWith('$') || key.startsWith('foundry')) continue;
                    if (!Array.isArray(data[key])) continue;
                    if (!merged[key]) merged[key] = [];
                    for (const item of data[key]) {
                        merged[key].push(item);
                    }
                }
            } catch {
                // 跳过不可读的文件
            }
        }

        // 写入 _all.json
        await fs.writeFile(
            path.join(dirPath, '_all.json'),
            JSON.stringify(merged, null, 2),
            'utf-8'
        );

        totalConsolidated++;
        totalFiles += jsonFiles.length;
    }

    if (totalConsolidated > 0) {
        console.log(`[${getTimestamp()}] homebrew 数据合并完成: ${totalConsolidated} 个目录，${totalFiles} 个文件 → ${totalConsolidated} 个 _all.json`);
    } else {
        console.log(`[${getTimestamp()}] 无需合并，所有目录已是出版物格式`);
    }
};

/**
 * 克隆中英文 homebrew 仓库并处理数据。
 */
const getHomebrewRepoData = async (
    enRepoUrl: string,
    zhRepoUrl: string,
    enTargetDir: string,
    zhTargetDir: string
) => {
    const proxy = buildProxyEnv();
    if (proxy.sources.length > 0) {
        console.log(
            `[${getTimestamp()}] 检测到代理来源(${proxy.sources.join(
                '+'
            )})，优先级 env > git > windows`
        );
    }
    const execOptions = { stdio: 'inherit' as const, env: proxy.env };

    console.log(`[${getTimestamp()}] 开始克隆 homebrew 数据...`);

    // 克隆英文 homebrew
    try {
        await cloneHomebrewRepo(enRepoUrl, enTargetDir, execOptions);
    } catch (error) {
        console.error(`[${getTimestamp()}] 英文 homebrew 仓库克隆失败: ${error}`);
    }

    // 克隆中文 homebrew
    try {
        await cloneHomebrewRepo(zhRepoUrl, zhTargetDir, execOptions);
    } catch (error) {
        console.error(`[${getTimestamp()}] 中文 homebrew 仓库克隆失败: ${error}`);
    }

    // 生成 replace-logs-homebrew.json
    const commonParentDir = getCommonParentDir(config.DATA_ZH_DIR, config.DATA_EN_DIR);
    const replaceLogsPath = path.join(commonParentDir, 'replace-logs-homebrew.json');

    const enExists = await fs.access(enTargetDir).then(() => true).catch(() => false);
    const zhExists = await fs.access(zhTargetDir).then(() => true).catch(() => false);

    if (enExists && zhExists) {
        console.log(`[${getTimestamp()}] 生成 homebrew replace-logs...`);
        await generateHomebrewReplaceLogs(enTargetDir, zhTargetDir, replaceLogsPath);
    } else {
        console.warn(`[${getTimestamp()}] homebrew 仓库目录不完整，跳过 replace-logs 生成`);
    }

    // 解析 _copy 引用
    // homebrew 仓库没有 data/ 子目录，JSON 文件直接在仓库根目录下的各子目录中
    const enHomebrewDataPath = enTargetDir;
    const zhHomebrewDataPath = zhTargetDir;
    const enMainDataPath = path.join(path.dirname(config.DATA_EN_DIR), 'data');
    const zhMainDataPath = path.join(path.dirname(config.DATA_ZH_DIR), 'data');

    const enHomebrewDataExists = await fs.access(enHomebrewDataPath).then(() => true).catch(() => false);
    const zhHomebrewDataExists = await fs.access(zhHomebrewDataPath).then(() => true).catch(() => false);

    if (!enHomebrewDataExists || !zhHomebrewDataExists) {
        console.error(`[${getTimestamp()}] 错误: homebrew 目录不存在，无法处理 _copy 引用`);
        console.error(`[${getTimestamp()}]   - en homebrew: ${enHomebrewDataExists ? '存在' : '不存在'}`);
        console.error(`[${getTimestamp()}]   - zh homebrew: ${zhHomebrewDataExists ? '存在' : '不存在'}`);
        return;
    }

    // 第1步：全类别数据重组（先整理数据，确保 _copy 引用在干净的数据上解析）
    console.log(`[${getTimestamp()}] 开始重组 homebrew 全类别数据...`);
    await Promise.all([
        reorganizeAllHomebrewData(enHomebrewDataPath),
        reorganizeAllHomebrewData(zhHomebrewDataPath),
    ]);
    console.log(`[${getTimestamp()}] homebrew 全类别数据重组完成`);

    // 第2步：处理 _copy 引用（在重组后的数据上解析，确保引用指向正确目录）
    console.log(`[${getTimestamp()}] 开始处理 homebrew _copy 引用...`);

    await resolveCopiesInHomebrewDirectories(
        enMainDataPath,
        zhMainDataPath,
        enHomebrewDataPath,
        zhHomebrewDataPath
    );

    console.log(`[${getTimestamp()}] homebrew _copy 引用处理完成`);

    // 第3步：合并非出版物类别的数据为 _all.json（减少文件数，加速 start:homebrew 加载）
    console.log(`[${getTimestamp()}] 开始合并 homebrew 非出版物类别数据...`);
    await Promise.all([
        consolidateHomebrewData(enHomebrewDataPath),
        consolidateHomebrewData(zhHomebrewDataPath),
    ]);
    console.log(`[${getTimestamp()}] homebrew 数据合并完成`);
};

(async () => {
    try {
        const zhRoot = path.dirname(config.DATA_ZH_DIR);
        const enRoot = path.dirname(config.DATA_EN_DIR);

        const isHomebrew = process.argv.includes('--homebrew');

        if (isHomebrew) {
            const enHomebrewDir = path.join(enRoot, 'homebrew');
            const zhHomebrewDir = path.join(zhRoot, 'homebrew');

            console.log(`[${getTimestamp()}] === Homebrew 模式 ===`);
            await getHomebrewRepoData(
                'https://github.com/TheGiddyLimit/homebrew.git',
                'https://github.com/tjliqy/homebrew.git',
                enHomebrewDir,
                zhHomebrewDir
            );
            return;
        }

    const patchedRoot = './input/patched/';

    // 始终重新拉取最新数据（删除旧数据目录，重新克隆）
    const safeRemoveDir = async (dir: string) => {
        // 如果目录包含 homebrew 子目录，先删除除 homebrew 外的其他子目录
        const homebrewDir = path.join(dir, 'homebrew');
        const homebrewExists = await fs.access(homebrewDir).then(() => true).catch(() => false);
        if (homebrewExists) {
            // 只删除 data 和 js 子目录（保留 homebrew 目录）
            const subDirs = ['data', 'js'];
            for (const subDir of subDirs) {
                const subPath = path.join(dir, subDir);
                try {
                    await fs.rm(subPath, { recursive: true, force: true });
                } catch {
                    // 忽略错误
                }
            }
            return;
        }
        // 先清理残留的 git 进程
        try {
            execSync(`taskkill /f /im git.exe 2>nul`, { stdio: 'pipe' });
        } catch {
            // 忽略清理失败
        }
        // 重试删除，最多 3 次
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                return;
            } catch (err) {
                if (attempt < 3) {
                    console.log(`[${getTimestamp()}] 删除目录失败 (尝试 ${attempt}/3): ${dir}，等待后重试...`);
                    // 再次清理 git 进程
                    try {
                        execSync(`taskkill /f /im git.exe 2>nul`, { stdio: 'pipe' });
                    } catch {}
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    // 最后一次尝试：使用系统命令
                    console.log(`[${getTimestamp()}] 使用系统命令强制删除: ${dir}`);
                    try {
                        execSync(`rmdir /s /q "${dir}" 2>nul`, { stdio: 'pipe' });
                    } catch (e) {
                        throw new Error(`无法删除目录 ${dir}: ${err}`);
                    }
                }
            }
        }
    };
    const paths = [zhRoot, enRoot, patchedRoot];
    for (const dirPath of paths) {
        await safeRemoveDir(dirPath);
        await fs.mkdir(dirPath, { recursive: true });
    }

    console.log(`[${getTimestamp()}] 开始克隆中英数据...`);
    await getRepoData(
        'https://github.com/tjliqy/5etools-mirror-2.github.io.git',   // 中文仓库
        'https://github.com/5etools-mirror-3/5etools-src.git',          // 英文仓库（官方最新）
        { zh: zhRoot, en: enRoot }
    );
    
    // 检查数据目录是否存在
    const zhDataPath = path.join(zhRoot, 'data');
    const enDataPath = path.join(enRoot, 'data');
    const zhDataExists = await fs.access(zhDataPath).then(() => true).catch(() => false);
    const enDataExists = await fs.access(enDataPath).then(() => true).catch(() => false);
    
    if (!zhDataExists || !enDataExists) {
        console.error(`[${getTimestamp()}] 错误: 数据目录不存在，无法继续处理 _copy 引用`);
        console.error(`[${getTimestamp()}]   - zh/data: ${zhDataExists ? '存在' : '不存在'}`);
        console.error(`[${getTimestamp()}]   - en/data: ${enDataExists ? '存在' : '不存在'}`);
        process.exit(1);
    }
    
    console.log(`[${getTimestamp()}] 开始处理 _copy 引用...`);
    
    await resolveCopiesInBothDirectories(
        enDataPath,
        zhDataPath,
        enDataPath,
        zhDataPath
    );
    
    // 验证处理结果
    const zhBestiaryPath = path.join(zhDataPath, 'bestiary', 'bestiary-lox.json');
    const zhContent = await fs.readFile(zhBestiaryPath, 'utf-8');
    const zhCopyCount = (zhContent.match(/_copy/g) || []).length;
    // console.log(`[${getTimestamp()}] 处理后 bestiary-lox.json 中 _copy 的数量: ${zhCopyCount}`);
    
    if (zhCopyCount > 0) {
        console.log(`[${getTimestamp()}] WARNING: _copy 未完全处理！`);
    } else {
        console.log(`[${getTimestamp()}] SUCCESS: _copy 处理完成！`);
    }
    
    // console.log(`[${getTimestamp()}] success`);
    } catch (error: any) {
        console.error(`[${getTimestamp()}] 错误: ${error?.message || error}`);
        console.error(error?.stack || '');
        process.exit(1);
    }
})();