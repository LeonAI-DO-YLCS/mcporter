import type { CommandSpec, RawLifecycle, ServerDefinition, ServerLifecycle } from './config-schema.js';

const DEFAULT_KEEP_ALIVE = new Set(['chrome-devtools', 'mobile-mcp', 'playwright']);

const includeOverride = parseList(process.env.MCPORTER_KEEPALIVE);
const excludeOverride = parseList(process.env.MCPORTER_DISABLE_KEEPALIVE ?? process.env.MCPORTER_NO_KEEPALIVE);

interface OverrideSet {
  readonly all: boolean;
  readonly names: Set<string>;
}

interface CommandSignature {
  readonly fragments: string[];
}

const KEEP_ALIVE_COMMANDS: CommandSignature[] = [
  { fragments: ['chrome-devtools-mcp'] },
  { fragments: ['@mobilenext/mobile-mcp', 'mobile-mcp'] },
  { fragments: ['@playwright/mcp', 'playwright/mcp'] },
];

export function resolveLifecycle(
  name: string,
  rawLifecycle: RawLifecycle | undefined,
  command: CommandSpec
): ServerLifecycle | undefined {
  const normalizedName = name.toLowerCase();
  const forcedDisable = excludeOverride.all || excludeOverride.names.has(normalizedName);
  const forcedEnable = includeOverride.all || includeOverride.names.has(normalizedName);

  if (forcedEnable) {
    return { mode: 'keep-alive' };
  }
  if (forcedDisable) {
    return undefined;
  }

  const lifecycle = rawLifecycle ? coerceLifecycle(rawLifecycle) : undefined;
  if (lifecycle) {
    return lifecycle;
  }
  if (DEFAULT_KEEP_ALIVE.has(normalizedName) || matchesKeepAliveSignature(command)) {
    return { mode: 'keep-alive' };
  }
  return undefined;
}

function matchesKeepAliveSignature(command: CommandSpec): boolean {
  if (command.kind !== 'stdio') {
    return false;
  }
  const tokens = [command.command, ...command.args].map((token) => token.toLowerCase());
  return KEEP_ALIVE_COMMANDS.some((signature) =>
    signature.fragments.some((fragment) => tokens.some((token) => token.includes(fragment)))
  );
}

function parseList(value: string | undefined): OverrideSet {
  if (!value) {
    return { all: false, names: new Set() };
  }
  const names = value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  if (names.includes('*')) {
    return { all: true, names: new Set() };
  }
  return { all: false, names: new Set(names) };
}

function coerceLifecycle(raw: RawLifecycle): ServerLifecycle | undefined {
  if (typeof raw === 'string') {
    if (raw === 'keep-alive') {
      return { mode: 'keep-alive' };
    }
    if (raw === 'ephemeral') {
      return { mode: 'ephemeral' };
    }
    return undefined;
  }
  if (raw.mode === 'keep-alive') {
    const timeout =
      typeof raw.idleTimeoutMs === 'number' && Number.isFinite(raw.idleTimeoutMs) && raw.idleTimeoutMs > 0
        ? Math.trunc(raw.idleTimeoutMs)
        : undefined;
    return timeout ? { mode: 'keep-alive', idleTimeoutMs: timeout } : { mode: 'keep-alive' };
  }
  if (raw.mode === 'ephemeral') {
    return { mode: 'ephemeral' };
  }
  return undefined;
}

export function isKeepAliveServer(definition: ServerDefinition | undefined): boolean {
  return definition?.lifecycle?.mode === 'keep-alive';
}

export function keepAliveIdleTimeout(definition: ServerDefinition): number | undefined {
  if (definition.lifecycle?.mode !== 'keep-alive') {
    return undefined;
  }
  return definition.lifecycle.idleTimeoutMs;
}

export { DEFAULT_KEEP_ALIVE };
