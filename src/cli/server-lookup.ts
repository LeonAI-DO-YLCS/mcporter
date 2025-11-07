import type { ServerDefinition } from '../config.js';

export function findServerByHttpUrl(
  definitions: readonly ServerDefinition[],
  urlString: string
): string | undefined {
  const normalizedTarget = normalizeUrl(urlString);
  if (!normalizedTarget) {
    return undefined;
  }
  for (const definition of definitions) {
    if (definition.command.kind !== 'http') {
      continue;
    }
    const normalizedDefinitionUrl = normalizeUrl(definition.command.url);
    if (!normalizedDefinitionUrl) {
      continue;
    }
    if (normalizedDefinitionUrl === normalizedTarget) {
      return definition.name;
    }
  }
  return undefined;
}

function normalizeUrl(value: string | URL): string | undefined {
  try {
    const url = value instanceof URL ? value : new URL(value);
    // URL#href always ends with a trailing slash for bare origins; keep it for consistency
    return url.href.replace(/\/$/, '/');
  } catch {
    return undefined;
  }
}
