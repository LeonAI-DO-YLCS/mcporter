import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type CallToolParams,
  type CloseServerParams,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonRequestMethod,
  type ListResourcesParams,
  type ListToolsParams,
  type StatusResult,
} from './protocol.js';
import { getDaemonMetadataPath, getDaemonSocketPath } from './paths.js';
import { launchDaemonDetached } from './launch.js';

export interface DaemonClientOptions {
  readonly configPath: string;
  readonly rootDir?: string;
}

export interface DaemonPaths {
  readonly key: string;
  readonly socketPath: string;
  readonly metadataPath: string;
}

export function resolveDaemonPaths(configPath: string): DaemonPaths {
  const key = deriveConfigKey(configPath);
  return {
    key,
    socketPath: getDaemonSocketPath(key),
    metadataPath: getDaemonMetadataPath(key),
  };
}

export class DaemonClient {
  private readonly configKey: string;
  private readonly socketPath: string;
  private readonly metadataPath: string;
  private startingPromise: Promise<void> | null = null;

  constructor(private readonly options: DaemonClientOptions) {
    const paths = resolveDaemonPaths(options.configPath);
    this.configKey = paths.key;
    this.socketPath = paths.socketPath;
    this.metadataPath = paths.metadataPath;
  }

  async callTool(params: CallToolParams): Promise<unknown> {
    return this.invoke('callTool', params);
  }

  async listTools(params: ListToolsParams): Promise<unknown> {
    return this.invoke('listTools', params);
  }

  async listResources(params: ListResourcesParams): Promise<unknown> {
    return this.invoke('listResources', params);
  }

  async closeServer(params: CloseServerParams): Promise<void> {
    await this.invoke('closeServer', params);
  }

  async status(): Promise<StatusResult | null> {
    try {
      return (await this.sendRequest<StatusResult>('status', {})) as StatusResult;
    } catch (error) {
      if (isTransportError(error)) {
        return null;
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.sendRequest('stop', {});
    } catch (error) {
      if (isTransportError(error)) {
        return;
      }
      throw error;
    }
  }

  private async invoke<T = unknown>(method: DaemonRequestMethod, params: unknown): Promise<T> {
    await this.ensureDaemon();
    try {
      return (await this.sendRequest<T>(method, params)) as T;
    } catch (error) {
      if (isTransportError(error)) {
        await this.restartDaemon();
        return (await this.sendRequest<T>(method, params)) as T;
      }
      throw error;
    }
  }

  private async ensureDaemon(): Promise<void> {
    const available = await this.isResponsive();
    if (available) {
      return;
    }
    await this.startDaemon();
    await this.waitForReady();
  }

  private async restartDaemon(): Promise<void> {
    await this.startDaemon();
    await this.waitForReady();
  }

  private async startDaemon(): Promise<void> {
    if (this.startingPromise) {
      await this.startingPromise;
      return;
    }
    this.startingPromise = Promise.resolve().then(() => {
      launchDaemonDetached({
        configPath: this.options.configPath,
        rootDir: this.options.rootDir,
        metadataPath: this.metadataPath,
        socketPath: this.socketPath,
      });
    }).finally(() => {
      this.startingPromise = null;
    });
    await this.startingPromise;
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await this.isResponsive()) {
        return;
      }
      await delay(100);
    }
    throw new Error('Timeout while waiting for MCPorter daemon to start.');
  }

  private async isResponsive(): Promise<boolean> {
    try {
      await this.sendRequest('status', {});
      return true;
    } catch (error) {
      if (isTransportError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async sendRequest<T>(method: DaemonRequestMethod, params: unknown): Promise<T> {
    const request: DaemonRequest = {
      id: randomUUID(),
      method,
      params,
    };
    const payload = JSON.stringify(request);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      const finishReject = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };
      const finishResolve = (value: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      socket.setTimeout(30_000, () => {
        socket.destroy(Object.assign(new Error('Daemon request timed out.'), { code: 'ETIMEDOUT' }));
      });
      let buffer = '';
      socket.on('connect', () => {
        socket.write(payload, (error) => {
          if (error) {
            finishReject(error);
          }
          socket.end();
        });
      });
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
      });
      socket.on('end', () => finishResolve(buffer));
      socket.on('error', (error) => {
        finishReject(error as Error);
      });
    });
    const trimmed = response.trim();
    if (!trimmed) {
      const error = new Error('Empty daemon response.');
      (error as NodeJS.ErrnoException).code = 'ECONNRESET';
      throw error;
    }
    let parsed: DaemonResponse<T>;
    try {
      parsed = JSON.parse(trimmed) as DaemonResponse<T>;
    } catch (error) {
      const parseError = new Error('Failed to parse daemon response.');
      (parseError as NodeJS.ErrnoException).code = 'ECONNRESET';
      throw parseError;
    }
    if (!parsed.ok) {
      const error = new Error(parsed.error?.message ?? 'Daemon error');
      (error as NodeJS.ErrnoException).code = parsed.error?.code;
      throw error;
    }
    return parsed.result as T;
  }
}

function deriveConfigKey(configPath: string): string {
  const absolute = path.resolve(configPath);
  return crypto.createHash('sha1').update(absolute).digest('hex').slice(0, 12);
}

function isTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ECONNREFUSED' || code === 'ENOENT' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
