import type { ServerDefinition } from '../../src/config.js';
import type { ServerToolInfo } from '../../src/runtime.js';

export const integrationDefinition: ServerDefinition = {
  name: 'integration',
  description: 'Integration test server',
  command: { kind: 'http', url: 'https://example.com/mcp' },
  transport: 'stdio',
};

export const listCommentsTool: ServerToolInfo = {
  name: 'list_comments',
  description: 'List comments for an issue',
  inputSchema: {
    type: 'object',
    properties: {
      issueId: { type: 'string', description: 'Issue identifier' },
      limit: { type: 'number', description: 'Limit results', default: 10 },
    },
    required: ['issueId'],
  },
  outputSchema: { title: 'CommentList' },
};

export const demoTool: ServerToolInfo = {
  name: 'demo_tool',
  description: 'Demo tool',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'Value' },
    },
    required: ['value'],
  },
  outputSchema: { title: 'DemoResult' },
};
