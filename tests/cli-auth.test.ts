import { describe, expect, it, vi } from 'vitest';

process.env.MCPORTER_DISABLE_AUTORUN = '1';
const cliModulePromise = import('../src/cli.js');

const createRuntimeDouble = () => {
  const definitions = new Map<string, Record<string, unknown>>();
  const registerDefinition = vi.fn((definition: Record<string, unknown>) => {
    definitions.set(definition.name as string, { ...definition });
  });
  const getDefinition = vi.fn((name: string) => {
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown MCP server '${name}'.`);
    }
    return definition;
  });
  const listTools = vi.fn().mockResolvedValue([{ name: 'ok' }]);
  const runtime = {
    registerDefinition,
    getDefinition,
    getDefinitions: () => Array.from(definitions.values()),
    listTools,
  } as unknown as Awaited<ReturnType<typeof import('../src/runtime.js')['createRuntime']>>;
  return { runtime, listTools };
};

describe('mcporter auth ad-hoc support', () => {
  it('registers ad-hoc HTTP servers via --http-url', async () => {
    const { handleAuth } = await cliModulePromise;
    const { runtime, listTools } = createRuntimeDouble();

    await handleAuth(runtime, ['--http-url', 'https://mcp.deepwiki.com/sse']);

    expect(listTools).toHaveBeenCalledWith('mcp-deepwiki-com-sse', { autoAuthorize: true });
  });

  it('accepts bare URLs as the auth target', async () => {
    const { handleAuth } = await cliModulePromise;
    const { runtime, listTools } = createRuntimeDouble();

    await handleAuth(runtime, ['https://mcp.supabase.com/mcp']);

    expect(listTools).toHaveBeenCalledWith('mcp-supabase-com-mcp', { autoAuthorize: true });
  });
});
