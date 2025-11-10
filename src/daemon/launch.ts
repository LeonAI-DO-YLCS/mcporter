import path from 'node:path';
import { spawn } from 'node:child_process';

export interface DaemonLaunchOptions {
  readonly configPath: string;
  readonly rootDir?: string;
  readonly socketPath: string;
  readonly metadataPath: string;
}

export function launchDaemonDetached(options: DaemonLaunchOptions): void {
  const cliEntry = resolveCliEntry();
  const args = [
    ...process.execArgv,
    cliEntry,
    '--config',
    options.configPath,
    ...(options.rootDir ? ['--root', options.rootDir] : []),
    'daemon',
    'start',
    '--foreground',
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MCPORTER_DAEMON_CHILD: '1',
      MCPORTER_DAEMON_SOCKET: options.socketPath,
      MCPORTER_DAEMON_METADATA: options.metadataPath,
    },
  });
  child.unref();
}

function resolveCliEntry(): string {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('Unable to resolve mcporter entry script.');
  }
  return path.resolve(entry);
}
