import { describe, expect, it, vi } from 'vitest';

import { type ServerDefinition } from '../src/config.js';
import { __test } from '../src/runtime.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('maybeEnableOAuth', () => {
  const baseDefinition: ServerDefinition = {
    name: 'adhoc-server',
    command: { kind: 'http', url: new URL('https://example.com/mcp') },
    source: { kind: 'local', path: '<adhoc>' },
  };

  it('returns an updated definition for ad-hoc HTTP servers', () => {
    const updated = __test.maybeEnableOAuth(baseDefinition, logger as never);
    expect(updated).toBeDefined();
    expect(updated?.auth).toBe('oauth');
    expect(updated?.tokenCacheDir).toContain('adhoc-server');
    expect(logger.info).toHaveBeenCalled();
  });

  it('does not mutate non-ad-hoc servers', () => {
    const def: ServerDefinition = {
      name: 'local-server',
      command: { kind: 'http', url: new URL('https://example.com') },
      source: { kind: 'local', path: '/tmp/config.json' },
    };
    const updated = __test.maybeEnableOAuth(def, logger as never);
    expect(updated).toBeUndefined();
  });
});
