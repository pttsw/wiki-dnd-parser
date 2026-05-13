import fs from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import config from './config.js';
import { resolveCopiesInBothDirectories } from './copyResolver.js';

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
        // 直接克隆整个仓库，确保获取所有文件
        const cloneArgs = [
            'clone',
            '--depth',
            '1',
            ...(branch ? ['--branch', branch] : []),
            repoUrl,
            tempDir,
        ];
        console.log(`[${getTimestamp()}] 执行: git ${cloneArgs.join(' ')}`);
        execSync(`git ${cloneArgs.join(' ')}`, execOptions);
        console.log(`[${getTimestamp()}] 克隆完成！`);
        
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

(async () => {
    const zhRoot = path.dirname(config.DATA_ZH_DIR);
    const enRoot = path.dirname(config.DATA_EN_DIR);
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
    
    console.log(`[${getTimestamp()}] 开始处理 _copy 引用...`);
    // console.log(`[${getTimestamp()}] EN Path: ${path.join(enRoot, 'data')}`);
    // console.log(`[${getTimestamp()}] ZH Path: ${path.join(zhRoot, 'data')}`);
    
    await resolveCopiesInBothDirectories(
        path.join(enRoot, 'data'),
        path.join(zhRoot, 'data'),
        path.join(enRoot, 'data'),
        path.join(zhRoot, 'data')
    );
    
    // 验证处理结果
    const zhBestiaryPath = path.join(zhRoot, 'data', 'bestiary', 'bestiary-lox.json');
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
