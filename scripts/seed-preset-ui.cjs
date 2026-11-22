const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('../electron/store.cjs');
const { PRESETS, makeProject } = require('../electron/domain.cjs');
const { importSource } = require('../electron/media.cjs');
(async () => {
  const root = path.resolve('.ui-test', `presets-${randomUUID()}`), store = await Store.open(root);
  store.put('settings', 'default', { ...store.settings(), outputDir: path.join(root, 'output'), aiEngine: 'local' });
  const source = await importSource(path.resolve('.smoke-data', '프리셋 확장', '빨강 초록 파랑 원본.mp4'), path.join(root, 'source'), {});
  for (const preset of PRESETS) {
    const p = makeProject(source, preset); p.title = `[검증] ${preset.name}`; p.edit.title.text = preset.name;
    p.directory = path.join(root, 'output', 'projects', p.id); store.put('project', p.id, p);
  }
  store.close();
  fs.writeFileSync(path.resolve('.ui-test', 'latest-preset-test.json'), JSON.stringify({ root }, null, 2));
  console.log(root);
})().catch(e => { console.error(e); process.exitCode = 1; });
