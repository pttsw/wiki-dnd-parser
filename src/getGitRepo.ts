import fs from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';

const getTimestamp = () => {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // HH:MM:SS
};

/**
 * 将特定repo的data/data-bak/js目录克隆到目标路径。
 * @param repoUrl 仓库地址，例如 https://github.com/tjliqy/5etools-mirror-2.github.io.git
 * @param targetPaths 目标路径，例如 { zh: './input/5e-cn', en: './input/5e-en' }
 * @param branch 分支名（可选），默认使用仓库默认分支
 * @returns
 */
const getRepoData = async (
    repoUrl: string,
    targetPaths: { zh: string; en: string },
    branch?: string
) => {
    const branchText = branch ? ` (分支: ${branch})` : '';
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
        execSync(`git ${cloneArgs.join(' ')}`, { stdio: 'inherit' });

        console.log(`[${getTimestamp()}] 配置选择性检出(sparse-checkout)，仅下载data/data-bak/js目录...`);
        // 在tempDir执行git命令（而不是项目根目录）
        // sparse-checkout 仅checkout特定目录，包含init,set,checkout三步
        execSync(`git -C ${tempDir} sparse-checkout init --cone`, { stdio: 'inherit' });
        execSync(`git -C ${tempDir} sparse-checkout set data data-bak js`, { stdio: 'inherit' });
        execSync(`git -C ${tempDir} checkout`, { stdio: 'inherit' });

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
    // 预创建目录
    const paths = ['./input/5e-cn/', './input/5e-en/', './input/patched/'];
    await fs.rm('./input/', { recursive: true, force: true });
    for (const path of paths) {
        await fs.mkdir(path, { recursive: true });
    }

    console.log(`[${getTimestamp()}] 开始克隆中英数据...`);
    await getRepoData('https://github.com/tjliqy/5etools-mirror-2.github.io.git', {
        zh: './input/5e-cn',
        en: './input/5e-en',
    });
    console.log(`[${getTimestamp()}] success`);
})();
