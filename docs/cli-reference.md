# mcporter CLI Reference

A quick reference for the primary `mcporter` subcommands. Each command inherits
`--config <file>` and `--root <dir>` to override where servers are loaded from.

## `mcporter list [server]`
- Without arguments, lists every configured server (with live discovery + brief
  status).
- With a server name, prints TypeScript-style signatures for each tool, doc
  comments, and optional summaries.
- Flags:
  - `--all-parameters` – include every optional parameter in the signature.
  - `--schema` – pretty-print the JSON schema for each tool.
  - `--timeout <ms>` – per-server timeout when enumerating all servers.

## `mcporter call <server.tool>`
- Invokes a tool once and prints the response; supports positional arguments via
  pseudo-TS syntax and `--arg` flags.
- Useful flags:
  - `--server`, `--tool` – alternate way to target a tool.
  - `--timeout <ms>` – override call timeout (defaults to `CALL_TIMEOUT_MS`).
  - `--output text|markdown|json|raw` – choose how to render the `CallResult`.
  - `--tail-log` – stream tail output when the tool returns log handles.

## `mcporter generate-cli`
- Produces a standalone CLI for a single MCP server (optionally bundling or
  compiling with Bun).
- Key flags:
  - `--server <name>` (or inline JSON) – choose the server definition.
  - `--output <path>` – where to write the TypeScript template.
  - `--bundle <path>` – emit a bundle (Node/Bun) ready for `bun x`.
  - `--compile <path>` – compile with Bun (implies `--runtime bun`).
  - `--timeout <ms>` / `--runtime node|bun` – shared via the generator flag
    parser so defaults stay consistent.

## `mcporter emit-ts <server>`
- Emits TypeScript definitions (and optionally a ready-to-use client) describing
  a server’s tools. This reuses the same formatter as `mcporter list` so doc
  comments, signatures, and examples stay in sync.
- Modes:
  - `--mode types --out <file.d.ts>` (default) – export an interface whose
    methods return `Promise<CallResult>`, with doc comments and optional
    summaries.
  - `--mode client --out <file.ts>` – emit both the interface (`<file>.d.ts`)
    and a factory that wraps `createServerProxy`, returning objects whose
    methods resolve to `CallResult`.
- Other flags:
  - `--include-optional` (alias `--all-parameters`) – show every optional field.
  - `--types-out <file>` – override where the `.d.ts` sits when using client
    mode.

For more detail (behavioral nuances, OAuth flows, etc.), see `docs/spec.md` and
command-specific docs under `docs/`.
