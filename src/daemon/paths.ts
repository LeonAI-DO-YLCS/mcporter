import os from 'node:os';
import path from 'node:path';
import { expandHome } from '../env.js';

function resolveBaseDir(): string {
  const override = process.env.MCPORTER_DAEMON_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(expandHome(override.trim()));
  }
  return path.join(os.homedir(), '.mcporter');
}

function ensureRunDir(): string {
  return path.join(resolveBaseDir(), 'daemon');
}

export function getDaemonMetadataPath(configKey: string): string {
  return path.join(ensureRunDir(), `daemon-${configKey}.json`);
}

export function getDaemonSocketPath(configKey: string): string {
  const runDir = ensureRunDir();
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\mcporter-daemon-${configKey}`;
  }
  return path.join(runDir, `daemon-${configKey}.sock`);
}

export function getDaemonLogPath(configKey: string): string {
  return path.join(ensureRunDir(), `daemon-${configKey}.log`);
}

export function getDaemonDir(): string {
  return ensureRunDir();
}
