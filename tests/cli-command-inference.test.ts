import { describe, expect, it, vi } from 'vitest';

import { inferCommandRouting } from '../src/cli/command-inference.js';

const definitions = [
  { name: 'firecrawl', description: '', command: { kind: 'http' as const, url: new URL('https://example.com') } },
  { name: 'vercel', description: '', command: { kind: 'http' as const, url: new URL('https://api.vercel.com') } },
];

describe('command inference', () => {
  it('routes bare server names to list', () => {
    const result = inferCommandRouting('firecrawl', ['--schema'], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['firecrawl', '--schema'] });
  });

  it('respects explicit list command tokens', () => {
    const result = inferCommandRouting('list', [], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: [] });
  });

  it('treats describe as a hidden list alias', () => {
    const result = inferCommandRouting('describe', ['chrome-devtools'], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['chrome-devtools'] });
  });

  it('treats list-tools as a hidden list alias', () => {
    const result = inferCommandRouting('list-tools', ['linear'], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['linear'] });
  });

  it('auto-corrects close server names', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = inferCommandRouting('vercek', [], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['vercel'] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-corrected server name to vercel'));
    logSpy.mockRestore();
  });

  it('routes HTTP URLs to list for ad-hoc mode', () => {
    const result = inferCommandRouting('https://mcp.deepwiki.com/sse', [], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['https://mcp.deepwiki.com/sse'] });
  });

  it('routes scheme-less HTTP URLs to list for ad-hoc mode', () => {
    const result = inferCommandRouting('shadcn.io/api/mcp', [], definitions);
    expect(result).toEqual({ kind: 'command', command: 'list', args: ['shadcn.io/api/mcp'] });
  });

  it('routes HTTP tool selectors directly to call', () => {
    const token = 'https://api.example.com/mcp.getStatus';
    const result = inferCommandRouting(token, ['limit=1'], definitions);
    expect(result).toEqual({ kind: 'command', command: 'call', args: [token, 'limit=1'] });
  });

  it('routes HTTP tool expressions with arguments directly to call', () => {
    const token = 'https://api.example.com/mcp.getStatus(component: "foo")';
    const result = inferCommandRouting(token, [], definitions);
    expect(result).toEqual({ kind: 'command', command: 'call', args: [token] });
  });

  it('suggests names when edit distance is large', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = inferCommandRouting('unknown', [], definitions);
    expect(result).toEqual({ kind: 'abort', exitCode: 1 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('treats dotted selectors as call expressions', () => {
    const result = inferCommandRouting('firecrawl.scrape', ['--foo'], definitions);
    expect(result).toEqual({ kind: 'command', command: 'call', args: ['firecrawl.scrape', '--foo'] });
  });
});
