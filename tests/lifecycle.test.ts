import { afterEach, describe, expect, it, vi } from 'vitest';

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe('resolveLifecycle', () => {
  const chromeCommand = {
    kind: 'stdio' as const,
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    cwd: process.cwd(),
  };

  const customCommand = {
    kind: 'stdio' as const,
    command: 'node',
    args: ['server.js'],
    cwd: process.cwd(),
  };

  it('auto-enables keep-alive for chrome-devtools by default', async () => {
    delete process.env.MCPORTER_KEEPALIVE;
    delete process.env.MCPORTER_DISABLE_KEEPALIVE;
    vi.resetModules();
    const lifecycle = await import('../src/lifecycle.js');
    expect(lifecycle.resolveLifecycle('chrome-devtools', undefined, chromeCommand)).toEqual({ mode: 'keep-alive' });
  });

  it('allows disabling keep-alive via env override', async () => {
    process.env.MCPORTER_DISABLE_KEEPALIVE = 'chrome-devtools';
    vi.resetModules();
    const lifecycle = await import('../src/lifecycle.js');
    expect(lifecycle.resolveLifecycle('chrome-devtools', undefined, chromeCommand)).toBeUndefined();
  });

  it('respects explicit lifecycle objects', async () => {
    vi.resetModules();
    const lifecycle = await import('../src/lifecycle.js');
    expect(lifecycle.resolveLifecycle('custom', { mode: 'keep-alive', idleTimeoutMs: 5000 }, customCommand)).toEqual({
      mode: 'keep-alive',
      idleTimeoutMs: 5000,
    });
    expect(lifecycle.resolveLifecycle('custom', 'ephemeral', customCommand)).toEqual({ mode: 'ephemeral' });
  });

  it('infers keep-alive based on stdio command signature', async () => {
    vi.resetModules();
    const lifecycle = await import('../src/lifecycle.js');
    expect(lifecycle.resolveLifecycle('chrometools', undefined, chromeCommand)).toEqual({ mode: 'keep-alive' });
  });
});
