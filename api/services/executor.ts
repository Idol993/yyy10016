import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { getSandboxFsPath, getSandboxDiskUsage } from './sandboxFs.js';
import {
  runtimeShim,
  type SandboxInstance,
  type KillReason,
  type InstanceConfig,
  type RuntimeInfo,
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
let runtimeInitialized = false;
let runtimeInfo: RuntimeInfo | null = null;

async function ensureRuntime(): Promise<RuntimeInfo> {
  if (!runtimeInitialized) {
    runtimeInfo = await runtimeShim.init();
    runtimeInitialized = true;
  }
  return runtimeInfo!;
}

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

function buildSafeEnv(
  rootFs: string,
  proxyPort: number,
  runtimeType: string
): NodeJS.ProcessEnv {
  const proxyUrl = `socks5://127.0.0.1:${proxyPort}`;

  const env: NodeJS.ProcessEnv = {
    SANDBOX_MODE: '1',
    SANDBOX_RUNTIME: runtimeType,
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

  env['PYTHONPROXYS'] = proxyUrl;
  env['PIP_PROXY'] = proxyUrl;
  env['PIP_INDEX_URL'] = 'https://pypi.org/simple/';
  env['PIP_TRUSTED_HOST'] = 'pypi.org files.pythonhosted.org';
  env['REQUESTS_PROXIES'] = `{"http": "${proxyUrl}", "https": "${proxyUrl}"}`;
  env['URLLIB_PROXY'] = proxyUrl;

  env['CARGO_HTTP_PROXY'] = proxyUrl;
  env['CARGO_HTTPS_PROXY'] = proxyUrl;
  env['RUSTUP_DIST_SERVER'] = 'https://static.rust-lang.org';
  env['RUSTUP_UPDATE_ROOT'] = 'https://static.rust-lang.org/rustup';

  env['http_proxy'] = proxyUrl;
  env['HTTP_PROXY'] = proxyUrl;
  env['https_proxy'] = proxyUrl;
  env['HTTPS_PROXY'] = proxyUrl;
  env['ftp_proxy'] = proxyUrl;
  env['FTP_PROXY'] = proxyUrl;

  try {
    const wrapperPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.substring(1)), 'wrappers', 'node_socks.js');
    const winWrapperPath = wrapperPath.replace(/^\//, '');
    env['NODE_OPTIONS'] = `--require ${os.platform() === 'win32' ? winWrapperPath : wrapperPath}`;
    env['SANDBOX_NETWORK_WHITELIST'] = NETWORK_WHITELIST.join(',');
    env['SOCKS_PROXY_HOST'] = '127.0.0.1';
    env['SOCKS_PROXY_PORT'] = String(proxyPort);
  } catch {
    // ignore
  }

  return env;
}

async function compileIfNeeded(
  language: string,
  rootFs: string,
  proxyPort: number,
  runtimeType: string,
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

    const env = buildSafeEnv(rootFs, proxyPort, runtimeType);
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
    const rt = await ensureRuntime();
    const port = await ensureProxy();

    if (!rt.available) {
      callbacks.onOutput('system', '='.repeat(60) + '\n');
      callbacks.onOutput('system', '  [ERROR] Runtime Not Available\n');
      callbacks.onOutput('system', '='.repeat(60) + '\n');
      callbacks.onOutput('system', `  Detected: ${rt.name} ${rt.version}\n`);
      callbacks.onOutput('system', `  Available: ${rt.available}\n`);
      if (rt.error) {
        callbacks.onOutput('system', `  Error: ${rt.error}\n`);
      }
      callbacks.onOutput('system', '\n');
      callbacks.onOutput('system', '  gVisor and Firecracker are Linux-only technologies.\n');
      callbacks.onOutput('system', '  On Windows, this platform uses Windows Job Object isolation.\n');
      callbacks.onOutput('system', '  For true gVisor/Firecracker isolation, run on a Linux host.\n');
      callbacks.onOutput('system', '='.repeat(60) + '\n');
      return { error: rt.error || 'Runtime not available' };
    }

    callbacks.onOutput('system', '='.repeat(60) + '\n');
    callbacks.onOutput('system', `  ${rt.name}\n`);
    callbacks.onOutput('system', `  Version: ${rt.version}\n`);
    callbacks.onOutput('system', `  Runtime Type: ${rt.type}\n`);
    callbacks.onOutput('system', `  Isolation: ${rt.isolation}\n`);
    callbacks.onOutput('system', `  Network Proxy: socks5://127.0.0.1:${port}\n`);
    callbacks.onOutput('system', '='.repeat(60) + '\n');

    if (rt.type !== 'gvisor' && rt.type !== 'firecracker') {
      callbacks.onOutput('system', `[Warning] Not running in gVisor/Firecracker. ` +
        `Using ${rt.name} (native Windows isolation).\n`);
      callbacks.onOutput('system', `[Warning] For true gVisor/Firecracker isolation, ` +
        `deploy to a Linux host with runsc or firecracker installed.\n`);
    }

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
    callbacks.onOutput('system', `[Runtime] Runtime: ${rt.type}\n`);
    callbacks.onOutput('system', `[Runtime] Job Object: ${instance.jobObjectId}\n`);
    callbacks.onOutput('system', `[Runtime] Root FS: ${instance.rootFs}\n`);
    callbacks.onOutput('system', `[Runtime] Language: ${ctx.language}\n`);
    callbacks.onOutput('system', `[Runtime] CPU: ${ctx.cpuLimitPercent}% | Memory: ${ctx.memoryLimitMb} MB | Disk: ${ctx.diskLimitMb} MB\n`);
    callbacks.onOutput('system', `[Runtime] Network Whitelist: ${NETWORK_WHITELIST.join(', ')}\n`);

    const { cmd, args, entry } = buildCommand(ctx.language, instance.rootFs);
    const env = buildSafeEnv(instance.rootFs, port, rt.type);

    if ((ctx.language === 'python' || ctx.language === 'nodejs') && entry && !fs.existsSync(entry)) {
      callbacks.onOutput('stderr', `[Runtime] Entry file not found: ${entry}\n`);
      await runtimeShim.stopInstance(instance.id, 'error');
      return { error: `Entry file not found: ${entry}` };
    }

    if (ctx.language === 'cpp' || ctx.language === 'rust') {
      callbacks.onOutput('system', `[Runtime] Compiling ${ctx.language.toUpperCase()} source...\n`);
      const compileRes = await compileIfNeeded(ctx.language, instance.rootFs, port, rt.type, callbacks);
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

export async function getRuntimeMeta(): Promise<RuntimeInfo> {
  return await ensureRuntime();
}
