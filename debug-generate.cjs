const { spawnSync } = require('child_process');

console.log('开始调试 generateBookPages.ts...');

const result = spawnSync('node', ['--import', './loader.js', 'src/generateBookPages.ts'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DEBUG: 'true' }
});

console.log('退出码:', result.status);
if (result.error) {
    console.error('错误:', result.error);
}
