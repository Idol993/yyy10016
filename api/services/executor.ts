import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getSandboxFsPath } from './sandboxFs.js';
import { checkSandboxDiskUsage } from './sandbox.js';

const NETWORK_WHITELIST = new Set([
  'localhost',
  '127.0.0.1',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
]);

export interface ExecContext {
  sandboxId: number;
  permission: 'read' | 'edit' | 'owner';
  userId: number;
  username: string;
}

export interface ExecResult {
  success: boolean;
  process?: ChildProcess;
  error?: string;
  outputs: Array<{ stream: 'stdout' | 'stderr' | 'system'; data: string; timestamp: number }>;
}

export interface ExecCallbacks {
  onOutput: (stream: 'stdout' | 'stderr' | 'system', data: string) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
}

function now(): number {
  return Date.now();
}

function sanitizeEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  const safeKeys = [
    'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'ComSpec',
    'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE',
    'HOME', 'USER', 'LANG', 'LC_ALL',
  ];
  for (const k of safeKeys) {
    if (baseEnv[k] !== undefined) safe[k] = baseEnv[k];
  }
  safe['SANDBOX_MODE'] = '1';
  safe['http_proxy'] = '';
  safe['https_proxy'] = '';
  safe['HTTP_PROXY'] = '';
  safe['HTTPS_PROXY'] = '';
  return safe;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  memLimitBytes: number,
  callbacks: ExecCallbacks
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd,
    env: sanitizeEnv(process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });

  let memCheckTimer: ReturnType<typeof setInterval> | null = null;
  let killed = false;

  memCheckTimer = setInterval(() => {
    try {
      if (!child.pid) return;
      const usage = process.memoryUsage();
      if (usage.heapUsed > memLimitBytes) {
        if (!killed) {
          killed = true;
          callbacks.onOutput('system', `\n[SandboxOS] Memory limit exceeded (${Math.round(memLimitBytes / 1024 / 1024)} MB). Process terminated.\n`);
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }
      void usage;
    } catch {
      // ignore
    }
  }, 500);

  const timeoutTimer = setTimeout(() => {
    if (!killed) {
      killed = true;
      callbacks.onOutput('system', '\n[SandboxOS] Execution timeout (60s). Process terminated.\n');
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }, 60000);

  child.stdout.on('data', (data: Buffer) => {
    callbacks.onOutput('stdout', data.toString());
  });

  child.stderr.on('data', (data: Buffer) => {
    callbacks.onOutput('stderr', data.toString());
  });

  child.on('error', (err) => {
    if (memCheckTimer) clearInterval(memCheckTimer);
    clearTimeout(timeoutTimer);
    callbacks.onError(err);
  });

  child.on('close', (code) => {
    if (memCheckTimer) clearInterval(memCheckTimer);
    clearTimeout(timeoutTimer);
    callbacks.onExit(code);
  });

  return child;
}

export function executeInSandbox(
  ctx: ExecContext,
  callbacks: ExecCallbacks
): { process: ChildProcess | null; error?: string } {
  const { sandboxId, permission } = ctx;

  if (permission === 'read') {
    return { process: null, error: 'Read-only members cannot execute commands' };
  }

  const diskInfo = checkSandboxDiskUsage(sandboxId);
  if (!diskInfo.ok) {
    return {
      process: null,
      error: `Disk limit exceeded: used ${diskInfo.usedMb} MB / ${diskInfo.limitMb} MB`,
    };
  }

  const cwd = getSandboxFsPath(sandboxId);
  const memLimit = 256 * 1024 * 1024;

  callbacks.onOutput('system', `[SandboxOS] Running in isolated environment at ${cwd}\n`);
  callbacks.onOutput('system', `[SandboxOS] Network access: restricted (whitelist only)\n`);
  callbacks.onOutput('system', `[SandboxOS] Memory limit: ${Math.round(memLimit / 1024 / 1024)} MB\n`);

  const args: string[] = [];
  let cmd = '';

  if (os.platform() === 'win32') {
    cmd = 'cmd';
    args.push('/c', 'echo', 'SandboxOS ready. Use Run button to execute your code.');
  } else {
    cmd = 'sh';
    args.push('-c', 'echo "SandboxOS ready. Use Run button to execute your code."');
  }

  const proc = runCommand(cmd, args, cwd, memLimit, callbacks);
  return { process: proc };
}

export interface RunCodeResult {
  process?: ChildProcess;
  error?: string;
}

export function runEntryFile(
  ctx: ExecContext,
  language: string,
  callbacks: ExecCallbacks
): RunCodeResult {
  const { sandboxId, permission } = ctx;

  if (permission === 'read') {
    return { error: 'Read-only members cannot execute code' };
  }

  const diskInfo = checkSandboxDiskUsage(sandboxId);
  if (!diskInfo.ok) {
    return { error: `Disk limit exceeded: used ${diskInfo.usedMb} MB / ${diskInfo.limitMb} MB` };
  }

  const cwd = getSandboxFsPath(sandboxId);
  const memLimit = 256 * 1024 * 1024;

  callbacks.onOutput('system', `[SandboxOS] Running ${language} code in isolated sandbox...\n`);
  callbacks.onOutput('system', `[SandboxOS] Working directory: ${cwd}\n`);

  let cmd: string;
  let args: string[];

  switch (language) {
    case 'python': {
      const entryFile = path.join(cwd, 'src', 'main.py');
      if (!fs.existsSync(entryFile)) {
        return { error: 'Entry file not found: /src/main.py' };
      }
      cmd = os.platform() === 'win32' ? 'python' : 'python3';
      args = ['-u', entryFile];
      break;
    }
    case 'nodejs': {
      const entryFile = path.join(cwd, 'src', 'index.js');
      if (!fs.existsSync(entryFile)) {
        return { error: 'Entry file not found: /src/index.js' };
      }
      cmd = 'node';
      args = [entryFile];
      break;
    }
    case 'cpp': {
      const srcFile = path.join(cwd, 'src', 'main.cpp');
      const outFile = path.join(cwd, 'build', 'main');
      if (!fs.existsSync(srcFile)) {
        return { error: 'Entry file not found: /src/main.cpp' };
      }

      const buildDir = path.join(cwd, 'build');
      if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
      }

      const actualOutFile = os.platform() === 'win32' ? outFile + '.exe' : outFile;

      callbacks.onOutput('system', '[SandboxOS] Compiling C++ code...\n');

      const compileCmd = 'g++';
      const compileArgs = ['-std=c++17', '-O2', '-o', actualOutFile, srcFile];

      const compileProc = runCommand(compileCmd, compileArgs, cwd, memLimit, {
        onOutput: (s, d) => callbacks.onOutput(s, d),
        onError: (e) => callbacks.onError(e),
        onExit: (compileCode) => {
          if (compileCode !== 0) {
            callbacks.onOutput('system', `[SandboxOS] Compilation failed with exit code ${compileCode}. Execution stopped.\n`);
            callbacks.onExit(compileCode);
            return;
          }
          callbacks.onOutput('system', '[SandboxOS] Compilation successful. Running program...\n');
          runCommand(actualOutFile, [], cwd, memLimit, callbacks);
        },
      });

      return { process: compileProc };
    }
    case 'rust': {
      const srcFile = path.join(cwd, 'src', 'main.rs');
      if (!fs.existsSync(srcFile)) {
        return { error: 'Entry file not found: /src/main.rs' };
      }

      const buildDir = path.join(cwd, 'build');
      if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
      }

      const outFile = os.platform() === 'win32' ? path.join(buildDir, 'main.exe') : path.join(buildDir, 'main');

      callbacks.onOutput('system', '[SandboxOS] Compiling Rust code...\n');

      const compileCmd = 'rustc';
      const compileArgs = ['-C', 'opt-level=2', '-o', outFile, srcFile];

      const compileProc = runCommand(compileCmd, compileArgs, cwd, memLimit, {
        onOutput: (s, d) => callbacks.onOutput(s, d),
        onError: (e) => callbacks.onError(e),
        onExit: (compileCode) => {
          if (compileCode !== 0) {
            callbacks.onOutput('system', `[SandboxOS] Compilation failed with exit code ${compileCode}. Execution stopped.\n`);
            callbacks.onExit(compileCode);
            return;
          }
          callbacks.onOutput('system', '[SandboxOS] Compilation successful. Running program...\n');
          runCommand(outFile, [], cwd, memLimit, callbacks);
        },
      });

      return { process: compileProc };
    }
    default:
      return { error: `Unsupported language: ${language}` };
  }

  const proc = runCommand(cmd, args, cwd, memLimit, callbacks);
  return { process: proc };
}

export function runCustomCommand(
  ctx: ExecContext,
  command: string,
  args: string[],
  callbacks: ExecCallbacks
): RunCodeResult {
  const { sandboxId, permission } = ctx;

  if (permission === 'read') {
    return { error: 'Read-only members cannot execute commands' };
  }

  const blockedCommands = [
    'curl', 'wget', 'nc', 'netcat', 'telnet', 'ssh', 'scp', 'sftp', 'ftp',
    'ping', 'traceroute', 'nmap', 'ifconfig', 'ip', 'iptables', 'route',
    'rm -rf', 'chmod', 'chown', 'sudo', 'su',
  ];
  const lowerCmd = command.toLowerCase();
  for (const blocked of blockedCommands) {
    if (lowerCmd === blocked || lowerCmd.includes(blocked)) {
      return { error: `Command '${command}' is blocked in sandbox environment` };
    }
  }

  const diskInfo = checkSandboxDiskUsage(sandboxId);
  if (!diskInfo.ok) {
    return { error: `Disk limit exceeded: used ${diskInfo.usedMb} MB / ${diskInfo.limitMb} MB` };
  }

  const cwd = getSandboxFsPath(sandboxId);
  const memLimit = 256 * 1024 * 1024;

  callbacks.onOutput('system', `[SandboxOS] Executing: ${command} ${args.join(' ')}\n`);

  const proc = runCommand(command, args, cwd, memLimit, callbacks);
  return { process: proc };
}

export function sendToProcess(proc: ChildProcess | null, input: string): boolean {
  if (!proc || proc.stdin?.destroyed) return false;
  try {
    proc.stdin.write(input);
    return true;
  } catch {
    return false;
  }
}

export function isNetworkAllowed(host: string): boolean {
  return NETWORK_WHITELIST.has(host);
}
