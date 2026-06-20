import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { getSandboxFsPath, getSandboxDiskUsage } from './sandboxFs.js';
import {
  runtimeShim,
  RUNTIME_INFO,
  type SandboxInstance,
  type KillReason,
  type InstanceConfig,
} from './runtimeShim.js';
import { networkFilter, startNetworkProxy, type NetworkEvent } from './networkFilter.js';

export const NETWORK_WHITELIST = [
  'localhost',
  '127.0.0.1',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'index.crates.io',
  'nodejs.org',
];

export interface ExecContext {
  sandboxId: number;
  permission: 'read' | 'edit' | 'owner';
  userId: number;
  username: string;
  language: string;
  cpuLimitPercent: number;
  memoryLimitMb: number;
  diskLimitMb: number;
}

export interface ExecCallbacks {
  onOutput: (stream: 'stdout' | 'stderr' | 'system', data: string) => void;
  onExit: (code: number | null, reason?: KillReason) => void;
  onError: (err: Error) => void;
}

export interface RunCodeResult {
  instanceId?: string;
  error?: string;
}

let proxyStarted = false;
let proxyPort = 0;

async function ensureProxy(): Promise<number> {
  if (!proxyStarted) {
    proxyPort = await startNetworkProxy(NETWORK_WHITELIST);
    proxyStarted = true;
  }
  return proxyPort;
}

function buildCommand(language: string, rootFs: string): { cmd: string; args: string[]; entry: string } {
  switch (language) {
    case 'python': {
      const entry = path.join(rootFs, 'src', 'main.py');
      const pyBin = os.platform() === 'win32' ? 'python' : 'python3';
      return { cmd: pyBin, args: ['-u', entry], entry };
    }
    case 'nodejs': {
      const entry = path.join(rootFs, 'src', 'index.js');
      return { cmd: 'node', args: [entry], entry };
    }
    case 'cpp': {
      const entry = path.join(rootFs, 'build', os.platform() === 'win32' ? 'main.exe' : 'main');
      return { cmd: entry, args: [], entry };
    }
    case 'rust': {
      const entry = path.join(rootFs, 'build', os.platform() === 'win32' ? 'main.exe' : 'main');
      return { cmd: entry, args: [], entry };
    }
    default:
      return { cmd: os.platform() === 'win32' ? 'cmd' : 'sh', args: [], entry: '' };
  }
}

function buildSafeEnv(rootFs: string, proxyPort: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    SANDBOX_MODE: '1',
    SANDBOX_RUNTIME: RUNTIME_INFO.type,
    SANDBOX_ROOT: rootFs,
    TMPDIR: path.join(rootFs, 'tmp'),
    TEMP: path.join(rootFs, 'tmp'),
    HOME: path.join(rootFs, 'home'),
    USERPROFILE: path.join(rootFs, 'home'),
  };

  const keepKeys = [
    'PATH', 'SYSTEMROOT', 'ComSpec', 'PATHEXT', 'OS',
    'PROCESSOR_ARCHITECTURE', 'windir', 'ProgramData',
    'ProgramFiles', 'ProgramFiles(x86)', 'PUBLIC',
    'SystemDrive', 'ALLUSERSPROFILE',
  ];
  for (const k of keepKeys) {
    if (process.env[k]) env[k] = process.env[k];
  }

  const proxyUrl = `socks5://127.0.0.1:${proxyPort}`;
  env['http_proxy'] = proxyUrl;
  env['https_proxy'] = proxyUrl;
  env['HTTP_PROXY'] = proxyUrl;
  env['HTTPS_PROXY'] = proxyUrl;
  env['all_proxy'] = proxyUrl;
  env['ALL_PROXY'] = proxyUrl;
  env['socks_proxy'] = proxyUrl;
  env['SOCKS_PROXY'] = proxyUrl;
  env['no_proxy'] = '';
  env['NO_PROXY'] = '';
  env['GLOBAL_AGENT_HTTP_PROXY'] = proxyUrl;
  env['GLOBAL_AGENT_HTTPS_PROXY'] = proxyUrl;

  env['NODE_OPTIONS'] = `--require ${path.resolve(path.dirname(new URL(import.meta.url).pathname.substring(1)), 'wrappers', 'node_socks.js')}`;
  if (os.platform() === 'win32') {
    const p = path.resolve(path.dirname(new URL(import.meta.url).pathname.substring(1)), 'wrappers', 'node_socks.js');
    env['NODE_OPTIONS'] = `--require ${p}`;
  }

  return env;
}

async function compileIfNeeded(
  language: string,
  rootFs: string,
  proxyPort: number,
  callbacks: ExecCallbacks
): Promise<{ success: boolean; error?: string }> {
  if (language !== 'cpp' && language !== 'rust') return { success: true };

  const buildDir = path.join(rootFs, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    let srcFile: string;
    let outFile: string;

    if (language === 'cpp') {
      srcFile = path.join(rootFs, 'src', 'main.cpp');
      outFile = path.join(buildDir, os.platform() === 'win32' ? 'main.exe' : 'main');
      if (!fs.existsSync(srcFile)) {
        resolve({ success: false, error: 'Source file not found: /src/main.cpp' });
        return;
      }
      cmd = 'g++';
      args = ['-std=c++17', '-O2', '-o', outFile, srcFile];
    } else {
      srcFile = path.join(rootFs, 'src', 'main.rs');
      outFile = path.join(buildDir, os.platform() === 'win32' ? 'main.exe' : 'main');
      if (!fs.existsSync(srcFile)) {
        resolve({ success: false, error: 'Source file not found: /src/main.rs' });
        return;
      }
      cmd = 'rustc';
      args = ['-C', 'opt-level=2', '-o', outFile, srcFile];
    }

    const env = buildSafeEnv(rootFs, proxyPort);
    const proc = spawn(cmd, args, {
      cwd: rootFs,
      env,
      windowsHide: true,
    });

    proc.stdout.on('data', (d: Buffer) => callbacks.onOutput('stdout', d.toString()));
    proc.stderr.on('data', (d: Buffer) => callbacks.onOutput('stderr', d.toString()));

    proc.on('close', (code: number) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: `Compilation failed with exit code ${code}` });
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: `Compiler error: ${err.message}` });
    });
  });
}

export async function runEntryFile(
  ctx: ExecContext,
  callbacks: ExecCallbacks
): Promise<RunCodeResult> {
  if (ctx.permission === 'read') {
    return { error: 'Read-only members cannot execute code' };
  }

  const diskMb = Math.round(getSandboxDiskUsage(ctx.sandboxId) / 1024 / 1024);
  if (diskMb >= ctx.diskLimitMb) {
    return { error: `Disk limit exceeded: used ${diskMb} MB / ${ctx.diskLimitMb} MB` };
  }

  try {
    const port = await ensureProxy();

    callbacks.onOutput('system', '='.repeat(60) + '\n');
    callbacks.onOutput('system', `  ${RUNTIME_INFO.name} v${RUNTIME_INFO.version}\n`);
    callbacks.onOutput('system', `  Runtime Type: ${RUNTIME_INFO.type}\n`);
    callbacks.onOutput('system', `  Isolation: ${RUNTIME_INFO.isolation}\n`);
    callbacks.onOutput('system', `  Network Proxy: socks5://127.0.0.1:${port}\n`);
    callbacks.onOutput('system', '='.repeat(60) + '\n');

    const config: InstanceConfig = {
      cpuLimitPercent: ctx.cpuLimitPercent,
      memoryLimitBytes: ctx.memoryLimitMb * 1024 * 1024,
      diskLimitBytes: ctx.diskLimitMb * 1024 * 1024,
      networkWhitelist: NETWORK_WHITELIST,
      networkProxyPort: port,
    };

    const sourceFs = getSandboxFsPath(ctx.sandboxId);
    const instance = await runtimeShim.createInstance({
      sandboxId: ctx.sandboxId,
      language: ctx.language,
      sourceFsPath: sourceFs,
      config,
    });

    callbacks.onOutput('system', `[Runtime] Instance ID: ${instance.id}\n`);
    callbacks.onOutput('system', `[Runtime] Job Object: ${instance.jobObjectId}\n`);
    callbacks.onOutput('system', `[Runtime] Root FS: ${instance.rootFs}\n`);
    callbacks.onOutput('system', `[Runtime] Language: ${ctx.language}\n`);
    callbacks.onOutput('system', `[Runtime] CPU: ${ctx.cpuLimitPercent}% | Memory: ${ctx.memoryLimitMb} MB | Disk: ${ctx.diskLimitMb} MB\n`);
    callbacks.onOutput('system', `[Runtime] Network Whitelist: ${NETWORK_WHITELIST.join(', ')}\n`);

    const { cmd, args, entry } = buildCommand(ctx.language, instance.rootFs);
    const env = buildSafeEnv(instance.rootFs, port);

    if ((ctx.language === 'python' || ctx.language === 'nodejs') && entry && !fs.existsSync(entry)) {
      callbacks.onOutput('stderr', `[Runtime] Entry file not found: ${entry}\n`);
      await runtimeShim.stopInstance(instance.id, 'error');
      return { error: `Entry file not found: ${entry}` };
    }

    if (ctx.language === 'cpp' || ctx.language === 'rust') {
      callbacks.onOutput('system', `[Runtime] Compiling ${ctx.language.toUpperCase()} source...\n`);
      const compileRes = await compileIfNeeded(ctx.language, instance.rootFs, port, callbacks);
      if (!compileRes.success) {
        callbacks.onOutput('stderr', `[Runtime] ${compileRes.error || 'Compilation failed'}. Execution stopped.\n`);
        await runtimeShim.stopInstance(instance.id, 'error');
        return { error: compileRes.error || 'Compilation failed' };
      }
      callbacks.onOutput('system', '[Runtime] Compilation successful.\n');
    }

    const offHandler = (evt: NetworkEvent) => {
      if (evt.type === 'blocked') {
        callbacks.onOutput(
          'system',
          `[Network] BLOCKED: ${evt.protocol.toUpperCase()} ${evt.host}:${evt.port} ` +
          `- Host not in whitelist (whitelist: ${NETWORK_WHITELIST.join(', ')})\n`
        );
      }
    };
    networkFilter.on('network', offHandler);

    callbacks.onOutput('system', `[Runtime] Launching: ${cmd} ${args.join(' ')}\n`);
    callbacks.onOutput('system', '-'.repeat(60) + '\n');

    await runtimeShim.startInstance(instance.id, cmd, args, env, {
      onOutput: (s, d) => callbacks.onOutput(s, d),
      onExit: (code, reason) => {
        callbacks.onOutput('system', '-'.repeat(60) + '\n');
        if (reason === 'cpu') {
          callbacks.onOutput('system', `[Runtime] KILLED: CPU limit exceeded (${ctx.cpuLimitPercent}%)\n`);
        } else if (reason === 'memory') {
          callbacks.onOutput('system', `[Runtime] KILLED: Memory limit exceeded (${ctx.memoryLimitMb} MB)\n`);
        } else if (reason === 'disk') {
          callbacks.onOutput('system', `[Runtime] KILLED: Disk limit exceeded (${ctx.diskLimitMb} MB)\n`);
        } else if (reason === 'timeout') {
          callbacks.onOutput('system', `[Runtime] KILLED: Execution timeout (60s)\n`);
        }
        callbacks.onOutput('system', `[Runtime] Instance ${instance.id} exited with code ${code}${reason ? ` (reason: ${reason})` : ''}\n`);
        networkFilter.off('network', offHandler);
        callbacks.onExit(code, reason);
      },
      onError: (err) => {
        networkFilter.off('network', offHandler);
        callbacks.onError(err);
      },
    });

    return { instanceId: instance.id };
  } catch (err: unknown) {
    return { error: (err as Error).message };
  }
}

export function killRunningSandbox(sandboxId: number): boolean {
  const inst = runtimeShim.getInstanceBySandbox(sandboxId);
  if (inst) {
    runtimeShim.killInstance(inst.id, 'user');
    return true;
  }
  return false;
}

export function getRunningInstance(sandboxId: number): SandboxInstance | undefined {
  return runtimeShim.getInstanceBySandbox(sandboxId);
}

export function writeToRunningInstance(sandboxId: number, input: string): boolean {
  const inst = runtimeShim.getInstanceBySandbox(sandboxId);
  if (!inst) return false;
  return runtimeShim.writeToInstance(inst.id, input);
}

export function isNetworkAllowed(host: string): { allowed: boolean; reason?: string } {
  return networkFilter.isHostAllowed(host);
}

export { RUNTIME_INFO };
