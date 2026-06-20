type Language = 'python' | 'nodejs' | 'cpp' | 'rust';

interface SeccompRule {
  language: Language;
  allowedSyscalls: string[];
  blockedSyscalls: string[];
}

interface CgroupLimit {
  cpuQuota: number;
  memoryMaxBytes: number;
  pidsMax: number;
  networkAccess: boolean;
}

interface AnomalyDetection {
  instructionRate: number;
  syscallRate: number;
  memoryGrowthRate: number;
  flagged: boolean;
  reason: string;
}

const SECCOMP_RULES: SeccompRule[] = [
  {
    language: 'python',
    allowedSyscalls: [
      'read', 'write', 'open', 'close', 'stat', 'fstat', 'lstat',
      'poll', 'mmap', 'mprotect', 'munmap', 'brk', 'ioctl',
      'access', 'pipe', 'select', 'sched_yield', 'mremap',
      'nanosleep', 'clock_gettime', 'getpid', 'socket',
      'connect', 'clone', 'fork', 'execve', 'exit', 'wait4',
      'uname', 'fcntl', 'flock', 'fsync', 'dup', 'dup2',
      'gettimeofday', 'getrlimit', 'getrusage', 'sysinfo',
    ],
    blockedSyscalls: [
      'mount', 'umount', 'pivot_root', 'chroot', 'ptrace',
      'reboot', 'mount', 'kexec_load', 'init_module',
      'delete_module', 'iopl', 'ioperm', 'create_module',
    ],
  },
  {
    language: 'nodejs',
    allowedSyscalls: [
      'read', 'write', 'open', 'close', 'stat', 'fstat', 'lstat',
      'poll', 'mmap', 'mprotect', 'munmap', 'brk', 'ioctl',
      'access', 'pipe', 'select', 'mremap', 'nanosleep',
      'clock_gettime', 'getpid', 'socket', 'connect', 'clone',
      'fork', 'execve', 'exit', 'wait4', 'uname', 'fcntl',
      'flock', 'fsync', 'dup', 'dup2', 'gettimeofday',
      'getrlimit', 'getrusage', 'sysinfo', 'epoll_create',
      'epoll_ctl', 'epoll_wait', 'eventfd2', 'signalfd4',
    ],
    blockedSyscalls: [
      'mount', 'umount', 'pivot_root', 'chroot', 'ptrace',
      'reboot', 'kexec_load', 'init_module', 'delete_module',
      'iopl', 'ioperm',
    ],
  },
  {
    language: 'cpp',
    allowedSyscalls: [
      'read', 'write', 'open', 'close', 'stat', 'fstat', 'lstat',
      'poll', 'mmap', 'mprotect', 'munmap', 'brk', 'ioctl',
      'access', 'pipe', 'select', 'mremap', 'nanosleep',
      'clock_gettime', 'getpid', 'clone', 'exit', 'uname',
      'fcntl', 'dup', 'dup2', 'gettimeofday', 'arch_prctl',
      'set_tid_address', 'set_robust_list', 'futex', 'rseq',
      'madvise', 'getrandom',
    ],
    blockedSyscalls: [
      'socket', 'connect', 'mount', 'umount', 'pivot_root',
      'chroot', 'ptrace', 'reboot', 'fork', 'execve',
      'kexec_load', 'init_module', 'delete_module',
    ],
  },
  {
    language: 'rust',
    allowedSyscalls: [
      'read', 'write', 'open', 'close', 'stat', 'fstat', 'lstat',
      'poll', 'mmap', 'mprotect', 'munmap', 'brk', 'ioctl',
      'access', 'pipe', 'select', 'mremap', 'nanosleep',
      'clock_gettime', 'getpid', 'clone', 'exit', 'uname',
      'fcntl', 'dup', 'dup2', 'gettimeofday', 'arch_prctl',
      'set_tid_address', 'set_robust_list', 'futex', 'rseq',
      'madvise', 'getrandom', 'socket', 'connect',
    ],
    blockedSyscalls: [
      'mount', 'umount', 'pivot_root', 'chroot', 'ptrace',
      'reboot', 'fork', 'kexec_load', 'init_module',
      'delete_module',
    ],
  },
];

const CGROUP_LIMITS: Record<Language, CgroupLimit> = {
  python: { cpuQuota: 50000, memoryMaxBytes: 256 * 1024 * 1024, pidsMax: 64, networkAccess: true },
  nodejs: { cpuQuota: 50000, memoryMaxBytes: 512 * 1024 * 1024, pidsMax: 128, networkAccess: true },
  cpp: { cpuQuota: 50000, memoryMaxBytes: 128 * 1024 * 1024, pidsMax: 16, networkAccess: false },
  rust: { cpuQuota: 50000, memoryMaxBytes: 256 * 1024 * 1024, pidsMax: 32, networkAccess: false },
};

const ANOMALY_THRESHOLDS = {
  maxInstructionRate: 100000000,
  maxSyscallRate: 10000,
  maxMemoryGrowthRate: 50 * 1024 * 1024,
};

export function getSeccompRule(language: Language): SeccompRule {
  return SECCOMP_RULES.find((r) => r.language === language) || SECCOMP_RULES[1];
}

export function getCgroupLimit(language: Language): CgroupLimit {
  return CGROUP_LIMITS[language];
}

export function detectAnomaly(
  instructionCount: number,
  syscallCount: number,
  memoryDelta: number,
  elapsedMs: number,
): AnomalyDetection {
  const elapsedSec = Math.max(elapsedMs / 1000, 0.001);
  const instructionRate = instructionCount / elapsedSec;
  const syscallRate = syscallCount / elapsedSec;
  const memoryGrowthRate = memoryDelta / elapsedSec;

  const flagged =
    instructionRate > ANOMALY_THRESHOLDS.maxInstructionRate ||
    syscallRate > ANOMALY_THRESHOLDS.maxSyscallRate ||
    memoryGrowthRate > ANOMALY_THRESHOLDS.maxMemoryGrowthRate;

  let reason = '';
  if (instructionRate > ANOMALY_THRESHOLDS.maxInstructionRate) {
    reason = `Instruction rate ${instructionRate.toFixed(0)}/s exceeds threshold`;
  } else if (syscallRate > ANOMALY_THRESHOLDS.maxSyscallRate) {
    reason = `Syscall rate ${syscallRate.toFixed(0)}/s exceeds threshold`;
  } else if (memoryGrowthRate > ANOMALY_THRESHOLDS.maxMemoryGrowthRate) {
    reason = `Memory growth ${(memoryGrowthRate / 1024 / 1024).toFixed(1)}MB/s exceeds threshold`;
  }

  return {
    instructionRate,
    syscallRate,
    memoryGrowthRate,
    flagged,
    reason,
  };
}

export function validateSyscall(language: Language, syscall: string): boolean {
  const rule = getSeccompRule(language);
  if (rule.blockedSyscalls.includes(syscall)) return false;
  return true;
}

export function getAllSeccompRules(): SeccompRule[] {
  return SECCOMP_RULES;
}

export function getAllCgroupLimits(): Record<Language, CgroupLimit> {
  return CGROUP_LIMITS;
}
