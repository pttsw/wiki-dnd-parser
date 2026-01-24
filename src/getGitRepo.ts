import fs from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import config from './config.js';

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

    try {
        console.log(`[${getTimestamp()}] 清理临时目录...`);
        // 移除临时目录
        await fs.rm(tempDir, { recursive: true, force: true });

        console.log(`[${getTimestamp()}] 开始克隆仓库元数据...`);
        // clone仓库
        // --filter=blob:none 仅克隆metadata，不下载文件
        // --no-checkout 不下载文件
        // <depth> 仅克隆最新的提交
        // --branch 分支名
        // repo地址
        // 目标地址（临时文件夹）
        const cloneArgs = [
            'clone',
            '--filter=blob:none',
            '--no-checkout',
            '--depth',
            '1',
            ...(branch ? ['--branch', branch] : []),
            repoUrl,
            tempDir,
        ];
        execSync(`git ${cloneArgs.join(' ')}`, execOptions);

        console.log(`[${getTimestamp()}] 配置选择性检出(sparse-checkout)，仅下载data/data-bak/js目录...`);
        // 在tempDir执行git命令（而不是项目根目录）
        // sparse-checkout 仅checkout特定目录，包含init,set,checkout三步
        execSync(`git -C ${tempDir} sparse-checkout init --cone`, execOptions);
        execSync(`git -C ${tempDir} sparse-checkout set data data-bak js`, execOptions);
        execSync(`git -C ${tempDir} checkout`, execOptions);

        console.log(`[${getTimestamp()}] 移动数据文件到目标目录...`);
        // 将tempDir的data/data-bak目录移动到目标路径的data子目录（使用rename方法更快），然后删除tempDir
        const zhSourcePath = path.join(tempDir, 'data');
        const enSourcePath = path.join(tempDir, 'data-bak');
        const jsSourcePath = path.join(tempDir, 'js');
        const zhTargetPath = path.join(targetPaths.zh, 'data');
        const enTargetPath = path.join(targetPaths.en, 'data');
        const zhJsTargetPath = path.join(targetPaths.zh, 'js');
        const enJsTargetPath = path.join(targetPaths.en, 'js');
        await fs.rename(zhSourcePath, zhTargetPath);
        await fs.rename(enSourcePath, enTargetPath);
        await fs.cp(jsSourcePath, zhJsTargetPath, { recursive: true });
        await fs.cp(jsSourcePath, enJsTargetPath, { recursive: true });
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(
            `[${getTimestamp()}] 数据克隆成功: zh=${zhTargetPath}, en=${enTargetPath}, js=(${zhJsTargetPath}, ${enJsTargetPath})`
        );
    } catch (error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw error;
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
    console.log(`[${getTimestamp()}] success`);
})();
