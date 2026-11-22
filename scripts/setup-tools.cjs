const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Unzip, UnzipInflate } = require('fflate');
async function extractSelected(archive) {
  const unzip = new Unzip(file => {
    if (!/\/(?:ffmpeg|ffprobe)\.exe$|\/(?:LICENSE|README)(?:\.[\w-]+)?$/i.test(file.name)) return;
    const isExe = /\.exe$/.test(file.name);
    const targetDir = isExe ? tools : path.join(tools, 'licenses'); fs.mkdirSync(targetDir, { recursive: true });
    const fd = fs.openSync(path.join(targetDir, path.basename(file.name)), 'w');
    file.ondata = (error, chunk, final) => { if (error) { fs.closeSync(fd); throw error; } fs.writeSync(fd, chunk); if (final) fs.closeSync(fd); };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of fs.createReadStream(archive, { highWaterMark: 65536 })) unzip.push(chunk, false);
  unzip.push(new Uint8Array(), true);
}
const root = path.resolve(__dirname, '..');
const tools = path.join(root, 'assets', 'tools');
const tmp = path.join(root, '.dev-tools', 'downloads');
async function hashFile(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function get(url, file) {
  console.log('Downloading', url);
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
}
async function main() {
  fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
  const manifest = {};
  if (['ffmpeg.exe', 'ffprobe.exe'].some(name => !fs.existsSync(path.join(tools, name)))) {
    const release = await (await fetch('https://api.github.com/repos/GyanD/codexffmpeg/releases/tags/9.0.2')).json();
    const asset = release.assets?.find(a => /essentials_build\.zip$/.test(a.name));
    if (!asset) throw new Error('Official FFmpeg release asset not found');
    const url = asset.browser_download_url;
    const archive = path.join(tmp, 'ffmpeg.zip'); if (!fs.existsSync(archive)) await get(url, archive);
    const sha = asset.digest || await (await fetch(release.assets.find(a => a.name === asset.name + '.sha256')?.browser_download_url || 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256')).text();
    const actual = await hashFile(archive);
    if (!sha.toLowerCase().includes(actual)) throw new Error('FFmpeg SHA256 mismatch');
    await extractSelected(archive);
    if (!fs.existsSync(path.join(tools, 'ffprobe.exe'))) throw new Error('FFmpeg archive layout not found');
    manifest.ffmpeg = { url, sha256: actual };
  }
  if (!fs.existsSync(path.join(tools, 'yt-dlp.exe'))) {
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe';
    const sha256 = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d';
    const pending = path.join(tmp, 'yt-dlp.exe');
    await get(url, pending);
    if (await hashFile(pending) !== sha256) throw new Error('yt-dlp SHA256 mismatch');
    fs.copyFileSync(pending, path.join(tools, 'yt-dlp.exe'));
    manifest.ytdlp = { url, sha256 };
  }
  const manifestPath = path.join(tools, 'versions.json');
  manifest.binaries = {};
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe']) manifest.binaries[name] = { sha256: await hashFile(path.join(tools, name)) };
  fs.writeFileSync(manifestPath, JSON.stringify({ ...(fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {}), ...manifest, preparedAt: new Date().toISOString() }, null, 2));
  console.log('Media tools ready:', tools);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
