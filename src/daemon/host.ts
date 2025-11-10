import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntime, type Runtime } from '../runtime.js';
import type { ServerDefinition } from '../config.js';
import { keepAliveIdleTimeout, isKeepAliveServer } from '../lifecycle.js';
import {
  type CallToolParams,
  type CloseServerParams,
  type DaemonRequest,
  type DaemonResponse,
  type ListResourcesParams,
  type ListToolsParams,
  type StatusResult,
} from './protocol.js';

interface DaemonHostOptions {
  readonly socketPath: string;
  readonly metadataPath: string;
  readonly configPath: string;
  readonly rootDir?: string;
  readonly logPath?: string;
}

interface ServerActivity {
  connected: boolean;
  lastUsedAt?: number;
}

export async function runDaemonHost(options: DaemonHostOptions): Promise<void> {
  const runtime = await createRuntime({
    configPath: options.configPath,
    rootDir: options.rootDir,
  });
  const keepAliveDefinitions = runtime.getDefinitions().filter(isKeepAliveServer);
  if (keepAliveDefinitions.length === 0) {
    throw new Error('No MCP servers require keep-alive; daemon will not start.');
  }
  const managedServers = new Map<string, ServerDefinition>();
  for (const definition of keepAliveDefinitions) {
    managedServers.set(definition.name, definition);
  }

  await prepareSocket(options.socketPath);
  await fs.mkdir(path.dirname(options.metadataPath), { recursive: true });

  const activity = new Map<string, ServerActivity>();
  for (const definition of keepAliveDefinitions) {
    activity.set(definition.name, { connected: false });
  }

  const idleWatcher = setInterval(() => {
    void evictIdleServers(runtime, managedServers, activity);
  }, 30_000);
  idleWatcher.unref();

  const startedAt = Date.now();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      void handleSocketRequest(
        buffer,
        socket,
        runtime,
        managedServers,
        activity,
        {
          configPath: options.configPath,
          socketPath: options.socketPath,
          startedAt,
        },
        shutdown
      );
    });
    socket.on('error', () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  await fs.writeFile(
    options.metadataPath,
    JSON.stringify(
      {
        pid: process.pid,
        socketPath: options.socketPath,
        configPath: options.configPath,
        startedAt: Date.now(),
      },
      null,
      2
    ),
    'utf8'
  );

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(idleWatcher);
    server.close();
    await runtime.close().catch(() => {});
    await cleanupArtifacts(options);
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGQUIT', shutdown);
}

async function prepareSocket(socketPath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  try {
    await fs.unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.mkdir(path.dirname(socketPath), { recursive: true });
}

async function cleanupArtifacts(options: DaemonHostOptions): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await fs.unlink(options.socketPath);
    } catch {
      // ignore
    }
  }
  try {
    await fs.unlink(options.metadataPath);
  } catch {
    // ignore
  }
}

async function handleSocketRequest(
  rawPayload: string,
  socket: net.Socket,
  runtime: Runtime,
  managedServers: Map<string, ServerDefinition>,
  activity: Map<string, ServerActivity>,
  metadata: { configPath: string; socketPath: string; startedAt: number },
  shutdown: () => Promise<void>
): Promise<void> {
  const { response, shouldShutdown } = await processRequest(
    rawPayload,
    runtime,
    managedServers,
    activity,
    metadata
  );
  socket.write(JSON.stringify(response), () => {
    socket.end(() => {
      if (shouldShutdown) {
        void shutdown();
      }
    });
  });
}

async function processRequest(
  rawPayload: string,
  runtime: Runtime,
  managedServers: Map<string, ServerDefinition>,
  activity: Map<string, ServerActivity>,
  metadata: { configPath: string; socketPath: string; startedAt: number }
): Promise<{ response: DaemonResponse; shouldShutdown: boolean }> {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return { response: buildErrorResponse('unknown', 'empty_request'), shouldShutdown: false };
  }
  let request: DaemonRequest;
  try {
    request = JSON.parse(trimmed) as DaemonRequest;
  } catch (error) {
    return { response: buildErrorResponse('unknown', 'invalid_json', error), shouldShutdown: false };
  }
  const id = request.id ?? 'unknown';
  try {
    switch (request.method) {
      case 'callTool': {
        const params = request.params as CallToolParams;
        ensureManaged(params.server, managedServers);
        const result = await runtime.callTool(params.server, params.tool, { args: params.args ?? {} });
        markActivity(params.server, activity);
        return { response: { id, ok: true, result }, shouldShutdown: false };
      }
      case 'listTools': {
        const params = request.params as ListToolsParams;
        ensureManaged(params.server, managedServers);
        const result = await runtime.listTools(params.server, {
          includeSchema: params.includeSchema,
          autoAuthorize: params.autoAuthorize,
        });
        markActivity(params.server, activity);
        return { response: { id, ok: true, result }, shouldShutdown: false };
      }
      case 'listResources': {
        const params = request.params as ListResourcesParams;
        ensureManaged(params.server, managedServers);
        const result = await runtime.listResources(params.server, params.params);
        markActivity(params.server, activity);
        return { response: { id, ok: true, result }, shouldShutdown: false };
      }
      case 'closeServer': {
        const params = request.params as CloseServerParams;
        ensureManaged(params.server, managedServers);
        await runtime.close(params.server);
        activity.set(params.server, { connected: false });
        return { response: { id, ok: true, result: true }, shouldShutdown: false };
      }
      case 'status': {
        const result: StatusResult = {
          pid: process.pid,
          startedAt: metadata.startedAt,
          configPath: metadata.configPath,
          socketPath: metadata.socketPath,
          servers: Array.from(managedServers.values()).map((def) => {
            const entry = activity.get(def.name);
            return {
              name: def.name,
              connected: Boolean(entry?.connected),
              lastUsedAt: entry?.lastUsedAt,
            };
          }),
        };
        return { response: { id, ok: true, result }, shouldShutdown: false };
      }
      case 'stop': {
        return { response: { id, ok: true, result: true }, shouldShutdown: true };
      }
      default:
        return { response: buildErrorResponse(id, 'unknown_method'), shouldShutdown: false };
    }
  } catch (error) {
    return { response: buildErrorResponse(id, 'runtime_error', error), shouldShutdown: false };
  }
}

function ensureManaged(server: string, managedServers: Map<string, ServerDefinition>): void {
  if (!managedServers.has(server)) {
    throw new Error(`Server '${server}' is not managed by the daemon.`);
  }
}

function markActivity(server: string, activity: Map<string, ServerActivity>): void {
  const entry = activity.get(server);
  if (entry) {
    entry.connected = true;
    entry.lastUsedAt = Date.now();
  } else {
    activity.set(server, { connected: true, lastUsedAt: Date.now() });
  }
}

async function evictIdleServers(
  runtime: Runtime,
  managedServers: Map<string, ServerDefinition>,
  activity: Map<string, ServerActivity>
): Promise<void> {
  const now = Date.now();
  await Promise.all(
    Array.from(managedServers.entries()).map(async ([name, definition]) => {
      const timeout = keepAliveIdleTimeout(definition);
      if (!timeout) {
        return;
      }
      const entry = activity.get(name);
      if (!entry?.lastUsedAt) {
        return;
      }
      if (now - entry.lastUsedAt < timeout) {
        return;
      }
      await runtime.close(name).catch(() => {});
      activity.set(name, { connected: false });
    })
  );
}

function buildErrorResponse(id: string, code: string, error?: unknown): DaemonResponse {
  let message = code;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  }
  return {
    id,
    ok: false,
    error: {
      code,
      message,
    },
  };
}
