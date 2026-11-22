const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('먼저 pnpm build를 실행해 주세요.'); process.exit(1);
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [root], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
