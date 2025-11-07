import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliArtifactMetadata } from '../src/cli-metadata.js';
import { metadataPathForArtifact } from '../src/cli-metadata.js';

process.env.MCPORTER_DISABLE_AUTORUN = '1';

const generateCliMock = vi.fn(
  async (options: {
    serverRef: string;
    configPath?: string;
    rootDir?: string;
    outputPath?: string;
    runtime: 'node' | 'bun';
    bundle?: boolean | string;
    timeoutMs: number;
    minify: boolean;
    compile?: boolean | string;
  }) => ({
    outputPath: options.outputPath ?? path.join(os.tmpdir(), 'mcporter-out.ts'),
    bundlePath: typeof options.bundle === 'string' ? options.bundle : undefined,
    compilePath: typeof options.compile === 'string' ? options.compile : undefined,
  })
);

vi.mock('../src/generate-cli.js', () => ({
  generateCli: generateCliMock,
}));

const cliModule = await import('../src/cli.js');
const { handleInspectCli, handleRegenerateCli } = cliModule;

const tmpDir = path.join(os.tmpdir(), 'mcporter-cli-regenerate');

afterEach(async () => {
  generateCliMock.mockClear();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('inspect/regenerate CLI artifacts', () => {
  it('prints metadata summary for inspect-cli', async () => {
    const artifactPath = await writeMetadataFixture('binary');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleInspectCli([artifactPath]);

    const printed = logSpy.mock.calls
      .flat()
      .map((entry) => String(entry))
      .join('\n');
    expect(printed).toContain('Artifact:');
    expect(printed).toContain('Server: vercel');
    expect(printed).toContain('mcporter regenerate-cli');
    expect(printed).toContain('Underlying generate-cli command');

    logSpy.mockRestore();
  });

  it('regenerates artifact using stored invocation', async () => {
    const artifactPath = await writeMetadataFixture('binary');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleRegenerateCli([artifactPath], {});

    expect(generateCliMock).toHaveBeenCalledTimes(1);
    const invocation = generateCliMock.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      serverRef: 'vercel',
      configPath: '/tmp/config/mcporter.json',
      runtime: 'bun',
      compile: artifactPath,
      timeoutMs: 30000,
      minify: false,
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('Regenerated'))).toBe(true);

    logSpy.mockRestore();
  });

  it('supports dry-run regeneration without invoking generator', async () => {
    const artifactPath = await writeMetadataFixture('bundle');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleRegenerateCli(['--dry-run', artifactPath], {});

    expect(generateCliMock).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls
      .flat()
      .map((entry) => String(entry))
      .join('\n');
    expect(printed).toContain('Dry run');
    expect(printed).toContain('generate-cli --server');

    logSpy.mockRestore();
  });

  it('falls back to legacy metadata files when present', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const artifactPath = path.join(tmpDir, 'legacy-artifact');
    const script = '#!/usr/bin/env node\nconsole.log("noop");\n';
    await fs.writeFile(artifactPath, script, 'utf8');
    await fs.chmod(artifactPath, 0o755);

    const metadata: CliArtifactMetadata = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generator: { name: 'mcporter', version: '0.1.0' },
      server: {
        name: 'legacy',
        source: { kind: 'local', path: '/tmp/config/mcporter.json' },
        definition: {
          name: 'legacy',
          description: 'Legacy test server',
          command: { kind: 'http', url: 'https://example.com/mcp' },
        },
      },
      artifact: {
        path: artifactPath,
        kind: 'template',
      },
      invocation: {
        serverRef: 'legacy',
        configPath: '/tmp/config/mcporter.json',
        runtime: 'node',
        timeoutMs: 30_000,
        minify: false,
      },
    };
    await fs.writeFile(metadataPathForArtifact(artifactPath), JSON.stringify(metadata, null, 2), 'utf8');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleInspectCli([artifactPath]);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('legacy'))).toBe(true);
    logSpy.mockRestore();
  });
});

type ArtifactKind = 'template' | 'bundle' | 'binary';

async function writeMetadataFixture(kind: ArtifactKind): Promise<string> {
  await fs.mkdir(tmpDir, { recursive: true });
  const artifactPath = path.join(tmpDir, `artifact-${kind}`);

  const definition = {
    name: 'vercel',
    description: 'Vercel MCP',
    command: {
      kind: 'http' as const,
      url: 'https://mcp.vercel.com',
      headers: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: metadata preserves env-placeholder format
        Authorization: 'Bearer ${VERCEL_TOKEN}',
      },
    },
    env: undefined,
    auth: 'oauth',
    tokenCacheDir: '/tmp/tokens',
    clientName: 'mcporter-cli',
    oauthRedirectUrl: 'http://localhost:3000/callback',
  };

  const invocation: CliArtifactMetadata['invocation'] = {
    serverRef: 'vercel',
    configPath: '/tmp/config/mcporter.json',
    rootDir: '/workspace',
    runtime: 'bun',
    outputPath: undefined,
    bundle: kind === 'bundle' ? artifactPath : undefined,
    compile: kind === 'binary' ? artifactPath : undefined,
    timeoutMs: 30000,
    minify: false,
  };

  const metadata: CliArtifactMetadata = {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    generator: { name: 'mcporter', version: '0.1.0' },
    server: {
      name: 'vercel',
      source: { kind: 'local' as const, path: '/tmp/config/mcporter.json' },
      definition,
    },
    artifact: {
      path: artifactPath,
      kind,
    },
    invocation,
  };

  const script = `#!/usr/bin/env node
const payload = ${JSON.stringify(metadata)};
if (process.argv[2] === '__mcporter_inspect') {
  const artifactPath = process.argv[1] || payload.artifact.path;
  payload.artifact.path = artifactPath;
  payload.artifact.kind = ${JSON.stringify(kind)};
  if (${JSON.stringify(kind)} === 'template') {
    payload.invocation.outputPath = payload.invocation.outputPath || artifactPath;
  } else if (${JSON.stringify(kind)} === 'bundle') {
    payload.invocation.bundle = payload.invocation.bundle || artifactPath;
  } else if (${JSON.stringify(kind)} === 'binary') {
    payload.invocation.compile = payload.invocation.compile || artifactPath;
  }
  console.log(JSON.stringify(payload));
  process.exit(0);
}
console.log('mock cli');
`;

  await fs.writeFile(artifactPath, script, 'utf8');
  await fs.chmod(artifactPath, 0o755);
  return artifactPath;
}
