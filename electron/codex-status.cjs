const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createHash } = require('node:crypto');
const { detectCli, cliCommand } = require('./ai.cjs');
const { killTree } = require('./process.cjs');

function rateWindows(response) {
  const entries = Object.entries(response?.rateLimitsByLimitId || {});
  if (!entries.length && response?.rateLimits) entries.push([response.rateLimits.limitId || 'codex', response.rateLimits]);
  return entries.flatMap(([id, limit]) => ['primary', 'secondary'].flatMap(period => {
    const row = limit?.[period];
    if (!row || !Number.isFinite(row.usedPercent)) return [];
    return [{ id, name: limit.limitName || (id === 'codex' ? 'Codex' : id), period,
      remaining: Math.max(0, Math.min(100, 100 - row.usedPercent)),
      minutes: Number.isFinite(row.windowDurationMins) ? row.windowDurationMins : null,
      resetsAt: Number.isFinite(row.resetsAt) ? row.resetsAt : null }];
  }));
}

async function readAccount(settings, cwd) {
  const checkedAt = Date.now();
  const exe = detectCli('codex', settings.codexPath);
  if (!exe) return { state: 'missing', checkedAt, windows: [] };
  const [command, args] = cliCommand(exe, ['app-server', '--listen', 'stdio://']);
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let identity = '', mode = '', closed = false;
    const finish = result => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      killTree(child);
      resolve({ windows: [], checkedAt, mode, identity, ...result });
    };
    const timer = setTimeout(() => finish({ state: identity ? 'unavailable' : 'offline' }), 12000);
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ ...(id ? { id } : {}), method, params }) + '\n');
    child.on('error', () => finish({ state: 'offline' }));
    child.stdin.on('error', () => finish({ state: 'offline' }));
    child.on('exit', () => finish({ state: identity ? 'unavailable' : 'offline' }));
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        if (message.error) return finish({ state: 'unsupported' });
        send(null, 'initialized');
        send(2, 'account/read', { refreshToken: false });
      }
      if (message.id === 2) {
        if (message.error) return finish({ state: 'offline' });
        const account = message.result?.account;
        if (!account) return finish({ state: 'login' });
        mode = account.type || 'unknown';
        // Account identifiers stay in this process and are used only to distinguish cached snapshots.
        identity = createHash('sha256').update(JSON.stringify(account)).digest('hex');
        if (/apikey/i.test(mode)) return finish({ state: 'unavailable' });
        send(3, 'account/rateLimits/read');
      }
      if (message.id === 3) {
        const windows = rateWindows(message.result);
        finish({ state: windows.length ? 'connected' : 'unavailable', windows });
      }
    });
    send(1, 'initialize', { clientInfo: { name: 'shorts_studio', version: require('../package.json').version }, capabilities: {} });
  });
}

class CodexStatus {
  constructor(store, emit) { this.store = store; this.emit = emit; this.active = new Map(); }
  record(projectId, jobId, event) {
    if (event.phase === 'start') this.active.set(event.id, { projectId, jobId });
    else {
      this.active.delete(event.id);
      const now = Date.now();
      const rows = this.store.get('codex', 'usage') || [];
      this.store.put('codex', 'usage', [...rows.filter(row => row.id !== event.id && row.at >= now - 86400000).slice(-999),
        { id: event.id, at: now, projectId, jobId, model: event.model || '', usage: event.usage || null }]);
    }
    this.emit(this.activity());
  }
  clear(jobId) {
    for (const [id, row] of this.active) if (row.jobId === jobId) this.active.delete(id);
    this.emit(this.activity());
  }
  activity() { return { active: this.active.size, rows: (this.store.get('codex', 'usage') || []).filter(row => row.at >= Date.now() - 86400000) }; }
  async account() {
    if (this.refresh) return this.refresh;
    const settings = this.store.settings();
    const key = settings.codexPath || 'automatic';
    this.refresh = (async () => {
      let status;
      try { status = await readAccount(settings, this.store.root); }
      catch { status = { state: 'offline', checkedAt: Date.now(), windows: [] }; }
      if (status.windows.length) this.previous = { ...status, key };
      else if (status.identity && this.previous && this.previous.key === key && this.previous.identity === status.identity) {
        status = { ...status, windows: this.previous.windows, lastSuccess: this.previous.checkedAt };
      } else this.previous = null;
      const { identity, ...display } = status;
      return display;
    })();
    try { return await this.refresh; } finally { this.refresh = null; }
  }
}

module.exports = { CodexStatus, rateWindows, readAccount };
