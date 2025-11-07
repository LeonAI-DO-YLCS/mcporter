import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerDefinition } from '../config.js';
import type { Runtime } from '../runtime.js';
import { buildToolDoc } from './list-detail-helpers.js';
import { renderClientModule, renderTypesModule, type EmitMetadata, type ToolDocEntry } from './emit-ts-templates.js';
import type { ToolMetadata } from './generate/tools.js';
import { extractGeneratorFlags } from './generate/flag-parser.js';
import { loadToolMetadata } from './tool-cache.js';
import { readPackageMetadata } from './generate/template.js';

interface EmitTsFlags {
  server?: string;
  outPath?: string;
  mode: 'types' | 'client';
  includeOptional: boolean;
  typesOutPath?: string;
}

interface ParsedEmitTsOptions extends Required<Omit<EmitTsFlags, 'server' | 'outPath' | 'typesOutPath'>> {
  server: string;
  outPath: string;
  typesOutPath?: string;
}

export async function handleEmitTs(runtime: Runtime, args: string[]): Promise<void> {
  const options = parseEmitTsArgs(args);
  const definition = getServerDefinition(runtime, options.server);
  const metadataEntries = await loadToolMetadata(runtime, options.server, { includeSchema: true, autoAuthorize: false });
  const generator = await readPackageMetadata();
  const metadata: EmitMetadata = {
    server: definition,
    generatorLabel: `${generator.name}@${generator.version}`,
    generatedAt: new Date(),
  };
  const docEntries = buildDocEntries(options.server, metadataEntries, options.includeOptional);
  const interfaceName = buildInterfaceName(options.server);

  if (options.mode === 'types') {
    const source = renderTypesModule({ interfaceName, docs: docEntries, metadata });
    await writeFile(options.outPath, source);
    console.log(`Emitted TypeScript definitions for ${options.server} → ${options.outPath}`);
    return;
  }

  const typesOutPath = options.typesOutPath ?? deriveTypesOutPath(options.outPath);
  const relativeImportPath = computeImportPath(options.outPath, typesOutPath);
  const typesSource = renderTypesModule({ interfaceName, docs: docEntries, metadata });
  const clientSource = renderClientModule({
    interfaceName,
    docs: docEntries,
    metadata,
    typesImportPath: relativeImportPath,
  });
  await writeFile(typesOutPath, typesSource);
  await writeFile(options.outPath, clientSource);
  console.log(`Emitted client + types for ${options.server} → ${options.outPath} / ${typesOutPath}`);
}

function parseEmitTsArgs(args: string[]): ParsedEmitTsOptions {
  const flags: EmitTsFlags = {
    mode: 'types',
    includeOptional: false,
  };
  const common = extractGeneratorFlags(args, { allowIncludeOptional: true });
  if (common.includeOptional) {
    flags.includeOptional = true;
  }
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (!token) {
      index += 1;
      continue;
    }
    if (token === '--out') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--out' requires a path.");
      }
      flags.outPath = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--types-out') {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Flag '--types-out' requires a path.");
      }
      flags.typesOutPath = value;
      args.splice(index, 2);
      continue;
    }
    if (token === '--mode') {
      const value = args[index + 1];
      if (value !== 'types' && value !== 'client') {
        throw new Error("--mode must be 'types' or 'client'.");
      }
      flags.mode = value;
      args.splice(index, 2);
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown flag '${token}' for emit-ts.`);
    }
    index += 1;
  }

  const server = args.shift();
  if (!server) {
    throw new Error('Usage: mcporter emit-ts <server> --out <file> [--mode types|client]');
  }
  const outPath = flags.outPath;
  if (!outPath) {
    throw new Error("Flag '--out' is required for emit-ts.");
  }
  if (flags.mode === 'client' && !outPath.endsWith('.ts')) {
    throw new Error('--out should point to a .ts file when --mode client is used.');
  }
  if (flags.mode === 'types' && !outPath.endsWith('.ts') && !outPath.endsWith('.d.ts')) {
    throw new Error('--out should be a .ts or .d.ts file for --mode types.');
  }
  return {
    server,
    outPath: path.resolve(outPath),
    mode: flags.mode,
    includeOptional: flags.includeOptional,
    typesOutPath: flags.typesOutPath ? path.resolve(flags.typesOutPath) : undefined,
  };
}

function getServerDefinition(runtime: Runtime, name: string): ServerDefinition {
  try {
    return runtime.getDefinition(name);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw error;
  }
}

function buildDocEntries(serverName: string, metadataEntries: ToolMetadata[], includeOptional: boolean): ToolDocEntry[] {
  return metadataEntries.map((entry) => {
    const doc = buildToolDoc({
      serverName,
      toolName: entry.tool.name,
      description: entry.tool.description,
      outputSchema: entry.tool.outputSchema,
      options: entry.options,
      requiredOnly: !includeOptional,
      colorize: false,
      defaultReturnType: 'CallResult',
    });
    return {
      toolName: entry.tool.name,
      methodName: entry.methodName,
      doc,
    };
  });
}

function buildInterfaceName(serverName: string): string {
  const cleaned = serverName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  const base = cleaned.length > 0 ? cleaned : 'Server';
  return `${base}Tools`;
}

function deriveTypesOutPath(tsPath: string): string {
  const dir = path.dirname(tsPath);
  const base = path.basename(tsPath, path.extname(tsPath));
  return path.join(dir, `${base}.d.ts`);
}

async function writeFile(targetPath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${contents}\n`, 'utf8');
}

function computeImportPath(fromPath: string, typesPath: string): string {
  const fromDir = path.dirname(fromPath);
  const relative = path.relative(fromDir, typesPath).replace(/\\/g, '/');
  const withoutExt = relative.replace(/\.[^.]+$/, '');
  if (withoutExt.startsWith('.')) {
    return withoutExt;
  }
  return `./${withoutExt}`;
}

export const __test = {
  parseEmitTsArgs,
  buildInterfaceName,
  deriveTypesOutPath,
  computeImportPath,
  buildDocEntries,
};
