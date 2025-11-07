import { describe, expect, it, vi } from 'vitest';
import type { Runtime } from '../src/runtime.js';
import { loadToolMetadata } from '../src/cli/tool-cache.js';
import { demoTool } from './fixtures/tool-fixtures.js';

function createRuntimeStub(listToolsImpl: Runtime['listTools']): Runtime {
  return {
    listServers: () => [],
    getDefinitions: () => [],
    getDefinition: () => {
      throw new Error('not implemented');
    },
    registerDefinition: () => {},
    listTools: listToolsImpl,
    callTool: async () => ({}),
    listResources: async () => ({}),
    connect: async () => {
      throw new Error('not implemented');
    },
    close: async () => {},
  } as unknown as Runtime;
}

describe('loadToolMetadata', () => {
  it('caches repeated calls per runtime/server/options', async () => {
    const listTools = vi.fn(async () => [demoTool]);
    const runtime = createRuntimeStub(listTools);
    const first = await loadToolMetadata(runtime, 'integration', { includeSchema: true });
    const second = await loadToolMetadata(runtime, 'integration', { includeSchema: true });
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(first[0]?.tool.name).toBe('demo_tool');
    expect(second).toBe(first);
  });

  it('differentiates cache entries by includeSchema flag', async () => {
    const listTools = vi.fn(async () => [demoTool]);
    const runtime = createRuntimeStub(listTools);
    await loadToolMetadata(runtime, 'integration', { includeSchema: true });
    await loadToolMetadata(runtime, 'integration', { includeSchema: false });
    expect(listTools).toHaveBeenCalledTimes(2);
  });
});
