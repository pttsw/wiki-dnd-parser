import fs from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import config from './config.js';
import { resolveCopiesInBothDirectories, resolveCopiesInHomebrewDirectories } from './copyResolver.js';

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
        
        const previousCommit = execSync('git rev-parse HEAD~1', {
            cwd: repoDir,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        
        replaceLogs.commit = getCommitInfo(latestCommit, repoDir);
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
 * 将特定repo的data/data-bak/js目录克隆到目标路径。
 * @param repoUrl 仓库地址，例如 https://github.com/tjliqy/5etools-mirror-2.github.io.git
 * @param targetPaths 目标路径，例如 { zh: '<DATA_ZH_DIR父目录>', en: '<DATA_EN_DIR父目录>' }
 * @param branch 分支名（可选），默认使用仓库默认分支
 * @returns
 */
const getRepoData = async (
    repoUrl: string,
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
    console.log(`[${getTimestamp()}] 正在克隆仓库: ${repoUrl}${branchText}`);
    const tempDir = './temp-git-clone';

    // 安全删除目录，带重试
    const safeRmdir = async (dir: string, retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                return true;
            } catch (err: any) {
                if (err.code === 'EBUSY' && i < retries - 1) {
                    // console.log(`[${getTimestamp()}] 目录繁忙，等待重试...`);
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw err;
                }
            }
        }
        return false;
    };

    try {
        console.log(`[${getTimestamp()}] 清理临时目录...`);
        // 移除临时目录
        await safeRmdir(tempDir);

        console.log(`[${getTimestamp()}] 开始克隆仓库...`);
        // 使用 --depth 2 来获取最近两次提交，以便比较差异
        const cloneArgs = [
            'clone',
            '--depth',
            '2',
            ...(branch ? ['--branch', branch] : []),
            repoUrl,
            tempDir,
        ];
        console.log(`[${getTimestamp()}] 执行: git ${cloneArgs.join(' ')}`);
        execSync(`git ${cloneArgs.join(' ')}`, execOptions);
        console.log(`[${getTimestamp()}] 克隆完成！`);
        
        // 生成 replace-logs.json
        console.log(`[${getTimestamp()}] 生成 replace-logs.json...`);
        await generateReplaceLogs(tempDir, config.DATA_ZH_DIR, config.DATA_EN_DIR);
        
        // 检查目录结构
        const tempContent = await fs.readdir(tempDir, { withFileTypes: true });
        // console.log(`[${getTimestamp()}] 临时目录内容:`);
        for (const entry of tempContent) {
            // console.log(`[${getTimestamp()}]   - ${entry.name} (${entry.isDirectory() ? '目录' : '文件'})`);
        }

        // console.log(`[${getTimestamp()}] 移动数据文件到目标目录...`);
        // 将tempDir的data/data-bak目录移动到目标路径的data子目录（使用rename方法更快），然后删除tempDir
        const zhSourcePath = path.join(tempDir, 'data');
        const enSourcePath = path.join(tempDir, 'data-bak');
        const jsSourcePath = path.join(tempDir, 'js');
        const zhTargetPath = path.join(targetPaths.zh, 'data');
        const enTargetPath = path.join(targetPaths.en, 'data');
        const zhJsTargetPath = path.join(targetPaths.zh, 'js');
        const enJsTargetPath = path.join(targetPaths.en, 'js');
        
        // 确保目标目录存在
        await fs.mkdir(targetPaths.zh, { recursive: true });
        await fs.mkdir(targetPaths.en, { recursive: true });
        
        // 检查源文件是否存在
        const zhExists = await fs.access(zhSourcePath).then(() => true).catch(() => false);
        const enExists = await fs.access(enSourcePath).then(() => true).catch(() => false);
        const jsExists = await fs.access(jsSourcePath).then(() => true).catch(() => false);
        
        // console.log(`[${getTimestamp()}] 源文件检查 - data: ${zhExists}, data-bak: ${enExists}, js: ${jsExists}`);
        
        if (zhExists) {
            await fs.rm(zhTargetPath, { recursive: true, force: true });
            await fs.cp(zhSourcePath, zhTargetPath, { recursive: true });
            // console.log(`[${getTimestamp()}] 中文数据已复制到: ${zhTargetPath}`);
            
            // 验证复制结果
            const zhTargetContent = await fs.readdir(zhTargetPath);
            // console.log(`[${getTimestamp()}] 中文目标目录内容: ${zhTargetContent.join(', ')}`);
        } else {
            console.warn(`[${getTimestamp()}] 警告: 找不到中文数据源目录: ${zhSourcePath}`);
        }
        
        if (enExists) {
            await fs.rm(enTargetPath, { recursive: true, force: true });
            await fs.cp(enSourcePath, enTargetPath, { recursive: true });
            // console.log(`[${getTimestamp()}] 英文数据已复制到: ${enTargetPath}`);
            
            // 验证复制结果
            const enTargetContent = await fs.readdir(enTargetPath);
            // console.log(`[${getTimestamp()}] 英文目标目录内容: ${enTargetContent.join(', ')}`);
        } else {
            console.warn(`[${getTimestamp()}] 警告: 找不到英文数据源目录: ${enSourcePath}`);
        }
        
        if (jsExists) {
            await fs.rm(zhJsTargetPath, { recursive: true, force: true });
            await fs.rm(enJsTargetPath, { recursive: true, force: true });
            await fs.cp(jsSourcePath, zhJsTargetPath, { recursive: true });
            await fs.cp(jsSourcePath, enJsTargetPath, { recursive: true });
            // console.log(`[${getTimestamp()}] JS文件已复制`);
        } else {
            console.warn(`[${getTimestamp()}] 警告: 找不到JS源目录: ${jsSourcePath}`);
        }
        
        // 验证关键文件是否存在
        const zhBooksPath = path.join(zhTargetPath, 'books.json');
        const enBooksPath = path.join(enTargetPath, 'books.json');
        const zhBestiaryIndexPath = path.join(zhTargetPath, 'bestiary', 'index.json');
        const enBestiaryIndexPath = path.join(enTargetPath, 'bestiary', 'index.json');
        
        // console.log(`[${getTimestamp()}] 验证关键文件:`);
        const zhBooksExists = await fs.access(zhBooksPath).then(() => true).catch(() => false);
        const enBooksExists = await fs.access(enBooksPath).then(() => true).catch(() => false);
        const zhBestiaryIndexExists = await fs.access(zhBestiaryIndexPath).then(() => true).catch(() => false);
        const enBestiaryIndexExists = await fs.access(enBestiaryIndexPath).then(() => true).catch(() => false);
        
        // console.log(`[${getTimestamp()}]   - zh/books.json: ${zhBooksExists}`);
        // console.log(`[${getTimestamp()}]   - en/books.json: ${enBooksExists}`);
        // console.log(`[${getTimestamp()}]   - zh/bestiary/index.json: ${zhBestiaryIndexExists}`);
        // console.log(`[${getTimestamp()}]   - en/bestiary/index.json: ${enBestiaryIndexExists}`);
        
        // 尝试删除临时目录，但即使失败也继续执行
        try {
            await safeRmdir(tempDir);
            console.log(`[${getTimestamp()}] 临时目录已清理`);
        } catch (rmErr) {
            console.warn(`[${getTimestamp()}] 警告: 无法清理临时目录 ${tempDir}，忽略错误继续执行...`);
        }
        
        console.log(
            `[${getTimestamp()}] 数据克隆成功: zh=${zhTargetPath}, en=${enTargetPath}, js=(${zhJsTargetPath}, ${enJsTargetPath})`
        );
    } catch (error) {
        // 即使克隆过程出错，也尝试处理 _copy
        console.error(`[${getTimestamp()}] 克隆过程中出错: ${error}`);
        console.log(`[${getTimestamp()}] 继续尝试处理 _copy...`);
        // 不再抛出错误，让程序继续执行
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
 * 克隆单个 homebrew 仓库到目标目录，使用稀疏签出跳过不需要的目录和文件。
 */
const cloneHomebrewRepo = async (
    repoUrl: string,
    targetDir: string,
    execOptions: { stdio: 'inherit'; env: NodeJS.ProcessEnv }
) => {
    console.log(`[${getTimestamp()}] 正在克隆 homebrew 仓库: ${repoUrl}`);

    // 安全删除目标目录
    const safeRmdir = async (dir: string, retries = 3) => {
        for (let i = 0; i < retries; i++) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                return true;
            } catch (err: any) {
                if (err.code === 'EBUSY' && i < retries - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    throw err;
                }
            }
        }
        return false;
    };

    await safeRmdir(targetDir);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    // 使用 --filter=blob:none (blobless clone) + --no-checkout，
    // 仅下载 tree 对象，checkout 时按稀疏签出模式按需拉取 JSON 文件
    const cloneArgs = ['clone', '--depth', '2', '--filter=blob:none', '--no-checkout', repoUrl, targetDir];
    console.log(`[${getTimestamp()}] 执行: git ${cloneArgs.join(' ')}`);
    execSync(`git ${cloneArgs.join(' ')}`, execOptions);

    // 初始化稀疏签出（no-cone 模式支持排除模式）
    execSync(`git -C ${targetDir} sparse-checkout init --no-cone`, execOptions);

    // 写入稀疏签出模式
    await fs.writeFile(
        path.join(targetDir, '.git', 'info', 'sparse-checkout'),
        HOMEBREW_SPARSE_PATTERNS.join('\n') + '\n',
        'utf-8'
    );

    // 执行签出
    execSync(`git -C ${targetDir} checkout`, execOptions);
    console.log(`[${getTimestamp()}] homebrew 仓库克隆完成: ${targetDir}`);
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

    console.log(`[${getTimestamp()}] 开始处理 homebrew _copy 引用...`);

    await resolveCopiesInHomebrewDirectories(
        enMainDataPath,
        zhMainDataPath,
        enHomebrewDataPath,
        zhHomebrewDataPath
    );

    console.log(`[${getTimestamp()}] homebrew _copy 引用处理完成`);
};

(async () => {
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

    // 预创建目录
    const paths = [zhRoot, enRoot, patchedRoot];
    for (const dirPath of paths) {
        await fs.rm(dirPath, { recursive: true, force: true });
        await fs.mkdir(dirPath, { recursive: true });
    }

    console.log(`[${getTimestamp()}] 开始克隆中英数据...`);
    await getRepoData('https://github.com/tjliqy/5etools-mirror-2.github.io.git', {
        zh: zhRoot,
        en: enRoot,
    });
    
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
})();