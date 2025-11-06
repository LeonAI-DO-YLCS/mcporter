import { describe, expect, it } from 'vitest';

import { extractEphemeralServerFlags } from '../src/cli/ephemeral-flags.js';

describe('extractEphemeralServerFlags', () => {
  it('parses HTTP URLs and env overrides', () => {
    const args = ['--http-url', 'https://mcp.example.com/mcp', '--env', 'TOKEN=abc', 'list'];
    const spec = extractEphemeralServerFlags(args);
    expect(spec).toEqual({ httpUrl: 'https://mcp.example.com/mcp', env: { TOKEN: 'abc' } });
    expect(args).toEqual(['list']);
  });

  it('captures stdio commands and additional args', () => {
    const args = ['--stdio', 'bun run ./server.ts', '--stdio-arg', '--watch', 'call'];
    const spec = extractEphemeralServerFlags(args);
    expect(spec).toEqual({ stdioCommand: 'bun run ./server.ts', stdioArgs: ['--watch'] });
    expect(args).toEqual(['call']);
  });
});
