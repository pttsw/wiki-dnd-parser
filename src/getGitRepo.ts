import fs from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';

const getTimestamp = () => {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // HH:MM:SS
};

/**
 * 将特定repo的data目录克隆到目标路径。
 * @param repo repo名，例如fvtt-cn/5etools
 * @param branch 分支名，例如develop
 * @param targetPath 目标路径，例如./input/5ecn
 * @returns
 */
const getRepoData = async (repo: string, branch: string, targetPath: string) => {
    console.log(`[${getTimestamp()}] 正在克隆仓库: ${repo} (分支: ${branch}) -> ${targetPath}`);
    const repoUrl = `https://github.com/${repo}.git`;
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
        execSync(
            `git clone --filter=blob:none --no-checkout --depth 1 --branch ${branch} ${repoUrl} ${tempDir}`,
            { stdio: 'inherit' }
        );

        console.log(`[${getTimestamp()}] 配置选择性检出(sparse-checkout)，仅下载data目录...`);
        // 在tempDir执行git命令（而不是项目根目录）
        // sparse-checkout 仅checkout特定目录，包含init,set,checkout三步
        execSync(`git -C ${tempDir} sparse-checkout init --cone`, { stdio: 'inherit' });
        execSync(`git -C ${tempDir} sparse-checkout set data`, { stdio: 'inherit' });
        execSync(`git -C ${tempDir} checkout`, { stdio: 'inherit' });

        console.log(`[${getTimestamp()}] 移动数据文件到目标目录...`);
        // 将tempDir的data目录移动到目标路径的data子目录（使用rename方法更快），然后删除tempDir
        const sourcePath = path.join(tempDir, 'data');
        const finalTargetPath = path.join(targetPath, 'data');
        await fs.rename(sourcePath, finalTargetPath);
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log(`[${getTimestamp()}] 数据克隆成功: ${repo} -> ${finalTargetPath}`);
    } catch (error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw error;
    }
};

(async () => {
    // 预创建目录
    const paths = ['./input/5e-cn/', './input/5e-en/', './input/patched/'];
    await fs.rm('./input/', { recursive: true, force: true });
    for (const path of paths) {
        await fs.mkdir(path, { recursive: true });
    }

    console.log(`[${getTimestamp()}] 开始克隆中文数据...`);
    await getRepoData('fvtt-cn/5etools', 'develop', './input/5e-cn');
    console.log(`[${getTimestamp()}] 开始克隆英文数据...`);
    await getRepoData('5etools-mirror-3/5etools-src', 'main', './input/5e-en');
    console.log(`[${getTimestamp()}] success`);
})();
