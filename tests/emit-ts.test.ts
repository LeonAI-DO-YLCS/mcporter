import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../src/runtime.js';
import { handleEmitTs, __test as emitTsTestInternals } from '../src/cli/emit-ts-command.js';
import { renderClientModule, renderTypesModule } from '../src/cli/emit-ts-templates.js';
import { buildToolMetadata } from '../src/cli/generate/tools.js';
import { integrationDefinition, listCommentsTool } from './fixtures/tool-fixtures.js';

function createRuntimeStub(): Runtime {
  return {
    listServers: () => ['integration'],
    getDefinitions: () => [integrationDefinition],
    getDefinition: () => integrationDefinition,
    registerDefinition: () => {},
    listTools: async () => [listCommentsTool],
    callTool: async () => ({}),
    listResources: async () => ({}),
    connect: async () => {
      throw new Error('not implemented');
    },
    close: async () => {},
  } as unknown as Runtime;
}

describe('emit-ts templates', () => {
  it('renders type declarations with CallResult returns', () => {
    const docs = emitTsTestInternals.buildDocEntries('integration', [buildToolMetadata(listCommentsTool)], false);
    const metadata = {
      server: integrationDefinition,
      generatorLabel: 'mcporter@test',
      generatedAt: new Date('2025-11-07T00:00:00Z'),
    };
    const source = renderTypesModule({ interfaceName: 'IntegrationTools', docs, metadata });
    expect(source).toContain('export interface IntegrationTools');
    expect(source).toContain('Promise<CommentList>');
    expect(source).toContain('Issue identifier');
  });

  it('renders client module that wraps proxy calls', () => {
    const docs = emitTsTestInternals.buildDocEntries('integration', [buildToolMetadata(listCommentsTool)], true);
    const metadata = {
      server: integrationDefinition,
      generatorLabel: 'mcporter@test',
      generatedAt: new Date('2025-11-07T00:00:00Z'),
    };
    const source = renderClientModule({
      interfaceName: 'IntegrationTools',
      docs,
      metadata,
      typesImportPath: './integration-client',
    });
    expect(source).toContain('createIntegrationClient');
    expect(source).toContain('wrapCallResult');
    expect(source).toContain('proxy.listComments');
  });
});

describe('handleEmitTs', () => {
  it('writes client and types files to disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'emit-ts-'));
    const runtime = createRuntimeStub();
    const clientPath = path.join(tmpDir, 'integration-client.ts');
    await handleEmitTs(runtime, ['integration', '--out', clientPath, '--mode', 'client']);
    const typesPath = path.join(tmpDir, 'integration-client.d.ts');
    const clientSource = await fs.readFile(clientPath, 'utf8');
    const typesSource = await fs.readFile(typesPath, 'utf8');
    expect(clientSource).toContain('createIntegrationClient');
    expect(typesSource).toContain('export interface IntegrationTools');
  });
});
