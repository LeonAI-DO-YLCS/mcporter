import { createRuntime } from '../runtime.js';
import { isKeepAliveServer } from '../lifecycle.js';
import { DaemonClient, resolveDaemonPaths } from '../daemon/client.js';
import { launchDaemonDetached } from '../daemon/launch.js';
import { runDaemonHost } from '../daemon/host.js';

interface DaemonCliOptions {
  readonly configPath: string;
  readonly rootDir?: string;
}

export async function handleDaemonCli(args: string[], options: DaemonCliOptions): Promise<void> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printDaemonHelp();
    return;
  }

  const client = new DaemonClient({
    configPath: options.configPath,
    rootDir: options.rootDir,
  });

  if (subcommand === 'start') {
    await handleDaemonStart(args, options, client);
    return;
  }
  if (subcommand === 'status') {
    await handleDaemonStatus(client);
    return;
  }
  if (subcommand === 'stop') {
    await client.stop();
    console.log('Daemon stopped (if it was running).');
    return;
  }

  throw new Error(`Unknown daemon subcommand '${subcommand}'.`);
}

function printDaemonHelp(): void {
  console.log(`Usage: mcporter daemon <start|status|stop>

Commands:
  start    Start the keep-alive daemon (auto-detects keep-alive servers).
  status   Show whether the daemon is running and which servers are active.
  stop     Shut down the daemon and all managed servers.

Flags:
  --foreground  Run the daemon in the current process (debug only).`);
}

async function handleDaemonStart(args: string[], options: DaemonCliOptions, client: DaemonClient): Promise<void> {
  const foregroundFlag = consumeFlag(args, '--foreground');
  const isChildLaunch = process.env.MCPORTER_DAEMON_CHILD === '1';
  const foreground = foregroundFlag || isChildLaunch;

  const runtime = await createRuntime({
    configPath: options.configPath,
    rootDir: options.rootDir,
  });
  const keepAlive = runtime.getDefinitions().filter(isKeepAliveServer);
  await runtime.close().catch(() => {});
  if (keepAlive.length === 0) {
    console.log('No MCP servers are configured for keep-alive; daemon not started.');
    return;
  }

  const paths = resolveDaemonPaths(options.configPath);
  const socketPath = process.env.MCPORTER_DAEMON_SOCKET ?? paths.socketPath;
  const metadataPath = process.env.MCPORTER_DAEMON_METADATA ?? paths.metadataPath;

  if (foreground) {
    await runDaemonHost({
      socketPath,
      metadataPath,
      configPath: options.configPath,
      rootDir: options.rootDir,
    });
    return;
  }

  const existing = await client.status();
  if (existing) {
    console.log(`Daemon already running (pid ${existing.pid}).`);
    return;
  }

  launchDaemonDetached({
    configPath: options.configPath,
    rootDir: options.rootDir,
    metadataPath,
    socketPath,
  });
  const ready = await waitFor(() => client.status(), 10_000, 100);
  if (!ready) {
    throw new Error('Failed to start daemon before timeout expired.');
  }
  console.log(`Daemon started for ${keepAlive.length} server(s).`);
}

async function handleDaemonStatus(client: DaemonClient): Promise<void> {
  const status = await client.status();
  if (!status) {
    console.log('Daemon is not running.');
    return;
  }
  console.log(`Daemon pid ${status.pid} — socket: ${status.socketPath}`);
  if (status.servers.length === 0) {
    console.log('No keep-alive servers registered.');
    return;
  }
  status.servers.forEach((server) => {
    const state = server.connected ? 'connected' : 'idle';
    const lastUsed = server.lastUsedAt ? ` (last used ${new Date(server.lastUsedAt).toISOString()})` : '';
    console.log(`- ${server.name}: ${state}${lastUsed}`);
  });
}

function consumeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, intervalMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) {
      return result;
    }
    await delay(intervalMs);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
