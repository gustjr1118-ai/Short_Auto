const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const execute = args => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
const target = process.argv[2] || 'dir';
if (!['dir', 'zip', '7z'].includes(target)) throw new Error(`Unknown Windows packaging target: ${target}`);
const tools = path.join(root, 'assets', 'tools');
const output = `release/${version}-optimized`;
if (['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe'].some(name => !fs.existsSync(path.join(tools, name)))) execute(['scripts/setup-tools.cjs']);
execute(['scripts/setup-whisper.cjs']);
execute(['node_modules/typescript/bin/tsc', '--noEmit']);
execute(['node_modules/vite/bin/vite.js', 'build']);
execute(['node_modules/electron-builder/out/cli/cli.js', '--win', target, '--x64', '--publish', 'never', `--config.directories.output=${output}`]);

async function writeChecksum() {
  const name = `Shorts-Studio-${version}-win-x64.${target}`;
  const archive = path.join(root, output, name);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  fs.writeFileSync(`${archive}.sha256`, `${hash.digest('hex')}  ${name}\n`, 'ascii');
}
if (target !== 'dir') writeChecksum().catch(error => { console.error(error); process.exitCode = 1; });
