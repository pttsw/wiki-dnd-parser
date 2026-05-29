const { spawn } = require('child_process');

console.log('Testing generateBookPages.ts...');

const child = spawn('node', ['--import', './loader.js', 'src/generateBookPages.ts'], {
    cwd: __dirname,
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: true
});

child.on('error', (err) => {
    console.error('Spawn error:', err);
});

child.on('close', (code) => {
    console.log('Process exited with code:', code);
});
