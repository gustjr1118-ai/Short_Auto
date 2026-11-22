const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { unzipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.dev-tools', 'whisper-b5127');
const target = path.join(root, 'assets', 'tools', 'whisper');
const files = {
  'windows.zip': ['https://github.com/ggml-org/whisper.cpp/releases/download/b5127/whisper-bin-x64.zip', 'f795b2292c7f4dc4caf73ff2cdbd5d7e2d1d3240099fb54a34fa2f7c0b126674'],
  'ggml-base-q5_1.bin': ['https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin', '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898'],
  'whisper.cpp-LICENSE.txt': ['https://raw.githubusercontent.com/ggml-org/whisper.cpp/b5127/LICENSE'],
  'OpenAI-Whisper-LICENSE.txt': ['https://raw.githubusercontent.com/openai/whisper/main/LICENSE'],
};

async function digest(file) {
  const sha = createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) sha.update(bytes);
  return sha.digest('hex');
}

async function prepare(name, [url, hash]) {
  const file = path.join(stage, name);
  if (fs.existsSync(file) && (!hash || await digest(file) === hash)) return file;
  const pending = file + '.partial';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Whisper download failed (${response.status}): ${name}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(pending));
    if (hash && await digest(pending) !== hash) throw new Error(`Whisper checksum mismatch: ${name}`);
    fs.renameSync(pending, file);
  } finally {
    fs.rmSync(pending, { force: true });
  }
  return file;
}

async function main() {
  fs.mkdirSync(stage, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const [archive, model, ...licenses] = await Promise.all(Object.entries(files).map(([name, source]) => prepare(name, source)));
  const bundle = unzipSync(fs.readFileSync(archive), {
    filter: entry => /(?:^|\/)Release\/(?:whisper-cli\.exe|whisper\.dll|ggml(?:-[\w-]+)?\.dll)$/i.test(entry.name),
  });
  const runtimeFiles = Object.entries(bundle);
  if (!runtimeFiles.some(([name]) => name.endsWith('/whisper-cli.exe'))) throw new Error('Whisper executable missing from the upstream archive');
  for (const [name, data] of runtimeFiles) fs.writeFileSync(path.join(target, path.basename(name)), data);
  for (const file of [model, ...licenses]) fs.copyFileSync(file, path.join(target, path.basename(file)));
  console.log('Bundled offline Whisper b5127 and multilingual base model.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
