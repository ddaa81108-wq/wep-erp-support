import { spawn, execFileSync } from 'node:child_process';
import { existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';

export function windowsPowerShellEnvironment(environment) {
  // Codex/PowerShell 7 may export its own module path. Windows PowerShell 5.1
  // needs its native modules first (including Get-FileHash), only in this child.
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  const windows = environment.SystemRoot || environment.WINDIR || 'C:\\Windows';
  const programs = environment.ProgramFiles || 'C:\\Program Files';
  clean.PSModulePath = [
    join(windows, 'System32/WindowsPowerShell/v1.0/Modules'),
    join(programs, 'WindowsPowerShell/Modules'),
  ].join(';');
  return clean;
}

export function runReleaseCheck(check, root, logPath) {
  let executable = process.execPath,
    args;
  if (check.npm) {
    const cli =
      process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!existsSync(cli)) throw new Error('Start verification with npm run verify:release.');
    args = [cli, 'run', check.npm];
  } else if (check.node) args = check.node;
  else {
    executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', check.powershell];
  }
  const log = logPath ? openSync(logPath, 'w') : null;
  return new Promise((resolve, reject) => {
    let settled = false,
      logFailure;
    const child = spawn(executable, args, {
      cwd: root,
      stdio: log === null ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env:
        check.powershell && process.platform === 'win32'
          ? windowsPowerShellEnvironment(process.env)
          : process.env,
    });
    const terminate = () => {
      try {
        if (process.platform === 'win32')
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill();
      }
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (log !== null) {
        try {
          closeSync(log);
        } catch (caught) {
          error ??= caught;
        }
      }
      if (error) reject(new Error(`${error.message}${logPath ? `; log: ${logPath}` : ''}`));
      else resolve();
    };
    const capture = (stream) => (chunk) => {
      if (settled) return;
      try {
        writeSync(log, chunk);
        stream.write(chunk);
      } catch (error) {
        logFailure = error;
        terminate();
      }
    };
    if (log !== null) {
      child.stdout.on('data', capture(process.stdout));
      child.stderr.on('data', capture(process.stderr));
    }
    const timer = setTimeout(() => {
      terminate();
      finish(new Error(`${check.id} exceeded the 20 minute limit`));
    }, 20 * 60_000);
    child.once('error', finish);
    // close follows exit and drains both output pipes before closing the log.
    child.once('close', (code, signal) =>
      finish(logFailure || (code === 0 ? null : new Error(`${check.id} failed (${signal ?? code})`))),
    );
  });
}
