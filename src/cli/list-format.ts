import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ServerDefinition, ServerSource } from '../config.js';
import type { ServerToolInfo } from '../runtime.js';
import { formatPathForDisplay } from './path-utils.js';
import { dimText, extraDimText, redText, yellowText } from './terminal.js';

export type StatusCategory = 'ok' | 'auth' | 'offline' | 'error';

export type ListSummaryResult =
  | {
      status: 'ok';
      server: ServerDefinition;
      tools: ServerToolInfo[];
      durationMs: number;
    }
  | {
      status: 'error';
      server: ServerDefinition;
      error: unknown;
      durationMs: number;
    };

export function renderServerListRow(
  result: ListSummaryResult,
  timeoutMs: number
): {
  line: string;
  summary: string;
  category: StatusCategory;
  authCommand?: string;
} {
  const description = result.server.description ? dimText(` — ${result.server.description}`) : '';
  const durationLabel = dimText(`${(result.durationMs / 1000).toFixed(1)}s`);
  const sourceSuffix = formatSourceSuffix(result.server.source);
  const prefix = `- ${result.server.name}${description}`;

  if (result.status === 'ok') {
    const toolSuffix =
      result.tools.length === 0
        ? 'no tools reported'
        : `${result.tools.length === 1 ? '1 tool' : `${result.tools.length} tools`}`;
    return {
      line: `${prefix} (${toolSuffix}, ${durationLabel})${sourceSuffix}`,
      summary: toolSuffix,
      category: 'ok',
    };
  }

  const timeoutSeconds = Math.round(timeoutMs / 1000);
  const advice = classifyListError(result.error, result.server.name, timeoutSeconds);
  return {
    line: `${prefix} (${advice.colored}, ${durationLabel})${sourceSuffix}`,
    summary: advice.summary,
    category: advice.category,
    authCommand: advice.authCommand,
  };
}

export function truncateForSpinner(text: string, maxLength = 72): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatSourceSuffix(source: ServerSource | undefined, inline = false): string {
  if (!source || source.kind !== 'import') {
    return '';
  }
  const formatted = formatPathForDisplay(source.path);
  const text = inline ? formatted : `[source: ${formatted}]`;
  const tinted = extraDimText(text);
  return inline ? tinted : ` ${tinted}`;
}

export function classifyListError(
  error: unknown,
  serverName: string,
  _timeoutSeconds: number
): {
  colored: string;
  summary: string;
  category: StatusCategory;
  authCommand?: string;
} {
  if (error instanceof UnauthorizedError) {
    const note = yellowText(`auth required — run 'mcporter auth ${serverName}'`);
    return { colored: note, summary: 'auth required', category: 'auth', authCommand: `mcporter auth ${serverName}` };
  }

  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : (JSON.stringify(error) ?? '');
  const normalized = rawMessage.toLowerCase();
  const statusMatch = rawMessage.match(/status code\s*\((\d{3})\)/i);
  // Guard optional capture groups before parsing so TypeScript stays happy under --strictNullChecks.
  const statusCodeText = statusMatch?.[1];
  const statusCode = statusCodeText ? Number.parseInt(statusCodeText, 10) : undefined;
  const authStatuses = new Set([401, 403, 405]);

  if (
    authStatuses.has(statusCode ?? -1) ||
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid_token') ||
    normalized.includes('forbidden')
  ) {
    const note = yellowText(`auth required — run 'mcporter auth ${serverName}'`);
    return { colored: note, summary: 'auth required', category: 'auth', authCommand: `mcporter auth ${serverName}` };
  }

  if (
    normalized.includes('fetch failed') ||
    normalized.includes('econnrefused') ||
    normalized.includes('connection refused') ||
    normalized.includes('connection closed') ||
    normalized.includes('connection reset') ||
    normalized.includes('socket hang up') ||
    normalized.includes('connect timeout') ||
    normalized.includes('network is unreachable') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('timeout after')
  ) {
    // Treat transport-layer disconnects as offline so the summary stays actionable instead of echoing low-level errors.
    const note = redText(`offline — unable to reach server`);
    return { colored: note, summary: 'offline', category: 'offline' };
  }

  const note = redText(rawMessage || 'unknown error');
  return { colored: note, summary: rawMessage || 'unknown error', category: 'error' };
}
