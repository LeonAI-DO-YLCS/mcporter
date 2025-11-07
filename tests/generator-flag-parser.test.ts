import { describe, expect, it } from 'vitest';
import { extractGeneratorFlags } from '../src/cli/generate/flag-parser.js';

describe('extractGeneratorFlags', () => {
  it('parses runtime and timeout flags', () => {
    const args = ['--runtime', 'bun', '--timeout', '4500', 'extra'];
    const common = extractGeneratorFlags(args);
    expect(common.runtime).toBe('bun');
    expect(common.timeout).toBe(4500);
    expect(args).toEqual(['extra']);
  });

  it('handles include optional aliases when enabled', () => {
    const args = ['--include-optional', '--all-parameters'];
    const common = extractGeneratorFlags(args, { allowIncludeOptional: true });
    expect(common.includeOptional).toBe(true);
    expect(args).toEqual([]);
  });
});
