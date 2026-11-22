const { spawn, execFile } = require('node:child_process');
const { fail } = require('./domain.cjs');
function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
}
function run(exe, args, { cwd, signal, onLine, onErrorLine, stdin, timeout = 1200000, env } = {}) {
  if (signal?.aborted) return Promise.reject(fail('작업을 취소했습니다.', 'CANCELLED'));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env: env || process.env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', partial = '', errorPartial = '', timedOut = false;
    const cancel = () => killTree(child);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => { stdout = (stdout + text).slice(-8 * 1024 * 1024); partial += text;
      const lines = partial.split(/[\r\n]+/); partial = lines.pop(); for (const line of lines) onLine?.(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => {
      stderr = (stderr + text).slice(-32000);
      if (onErrorLine) {
        const lines = (errorPartial + text).split(/[\r\n]+/);
        errorPartial = lines.pop();
        for (const line of lines) onErrorLine(line);
      }
    });
    child.stdin.on('error', () => {}); child.stdin.end(stdin || '');
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    child.once('error', e => { cleanup(); reject(fail(`실행 도구를 시작할 수 없습니다: ${e.message}`, 'TOOL_START')); });
    child.once('close', code => {
      cleanup();
      if (partial) onLine?.(partial);
      if (errorPartial) onErrorLine?.(errorPartial);
      if (signal?.aborted) reject(fail('작업을 취소했습니다.', 'CANCELLED'));
      else if (timedOut) reject(fail('작업 시간이 초과되었습니다.', 'TIMEOUT'));
      else if (code !== 0) {
        const detail = (stderr || stdout || '외부 도구 실행 실패').split(/\r?\n/).filter(line => line && !/^\s*(configuration:|libav|libsw|built with|ffmpeg version)/.test(line)).slice(-5).join('\n').slice(-700);
        const error = fail(`영상 처리 도구에서 오류가 발생했습니다. (종료 ${code})\n${detail}`, 'TOOL_FAILED'); error.detail = stderr.slice(-16000); error.exitCode = code; reject(error);
      }
      else resolve({ stdout, stderr });
    });
  });
}
module.exports = { run, killTree };
