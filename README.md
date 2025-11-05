# mcporter 🧳
_TypeScript runtime + CLI generator for the Model Context Protocol._

`mcporter` packages an ergonomic, composable toolkit that works equally well for command-line operators and long-running agents.

## Features

- **Zero-config CLI** – `npx mcporter list` and `npx mcporter call` get you from install to tool execution quickly, with niceties such as `--tail-log`.
- **Composable runtime API** – `createRuntime()` pools connections, handles retries, and exposes a typed interface for Bun/Node agents.
- **OAuth support** – automatic browser launches, local callback server, and token persistence under `~/.mcporter/<server>/` (compatible with existing `token_cache_dir` overrides).
- **Structured configuration** – reads `config/mcporter.json`, automatically merges Cursor/Claude/Codex configs when present, and expands `${ENV}` placeholders, stdio wrappers, and headers in a predictable way.
- **Integration-ready** – ships with unit and integration tests (including a streamable HTTP fixture) plus GitHub Actions CI, so changes remain trustworthy.

## Installation

```bash
pnpm add mcporter
# or
yarn add mcporter
# or
npm install mcporter
```

## Quick Start

```ts
import { createRuntime } from "mcporter";

const runtime = await createRuntime({ configPath: "./config/mcporter.json" });

const tools = await runtime.listTools("chrome-devtools");
const screenshot = await runtime.callTool("chrome-devtools", "take_screenshot", {
  args: { url: "https://x.com" },
});

await runtime.close();
```

Prefer `createRuntime` when you plan to issue multiple calls—the runtime caches connections, handles OAuth refreshes, and closes transports when you call `runtime.close()`.

An end-to-end example lives in `examples/context7-headlines.ts`; it resolves a library via Context7, fetches documentation, and prints the markdown headings. Run it with:

```
pnpm exec tsx examples/context7-headlines.ts
```

Need a quick, single invocation?

```ts
import { callOnce } from "mcporter";

const result = await callOnce({
  server: "firecrawl",
  toolName: "crawl",
  args: { url: "https://anthropic.com" },
  configPath: "./config/mcporter.json",
});
```

## CLI Reference

```
npx mcporter list                          # list all configured servers (non-blocking auth detection)
npx mcporter list vercel --schema          # show tool signatures + schemas
npx mcporter auth vercel                   # pre-authorize OAuth flows without listing tools
npx mcporter call linear.searchIssues owner=ENG status=InProgress
npx mcporter call signoz.query --tail-log  # print the tail of returned log files

# Local scripts for workspace automation
pnpm mcporter:list                                 # alias for mcporter list
pnpm mcporter:call chrome-devtools.getTabs --tail-log
pnpm mcporter:auth vercel                          # same as mcporter auth
```

`pnpm mcporter:list` respects `MCPORTER_LIST_TIMEOUT` (milliseconds, default `30000`). The aggregated view fans out in parallel and prints either the tool count or a short status (e.g., `auth required — run 'mcporter auth <name>'`). Export a higher timeout when you need to inspect slow-starting servers:

```
MCPORTER_LIST_TIMEOUT=120000 pnpm mcporter:list vercel
```

Common flags:

| Flag | Description |
| --- | --- |
| `--config <path>` | Path to `mcporter.json` (defaults to `./config/mcporter.json`). |
| `--root <path>` | Working directory for stdio commands (so `scripts/*` resolve correctly). |
| `--tail-log` | After the tool completes, print the last 20 lines of any referenced log file. |

### OAuth Flow

When a server entry declares `"auth": "oauth"`, the CLI/runtime will:

1. Launch a temporary callback server on `127.0.0.1`.
2. Open the authorization URL in your default browser (or print it if launching fails).
3. Exchange the resulting code and persist refreshed tokens under `~/.mcporter/<server>/`.

To reset credentials, delete that directory and rerun the command—`mcporter` will trigger a fresh login.

### Generate Standalone CLIs

`mcporter` can mint a fully standalone CLI for any server—handy when you want a single-purpose tool with friendly flags. You do **not** need an on-disk config; provide `--command` (optionally `--name`) or fall back to `--server '{...}'` for advanced options:

Generate a single executable you can ship to agents or drop on a PATH:

```bash
npx mcporter generate-cli --command https://mcp.context7.com/mcp --compile
chmod +x context7
./context7 list-tools
./context7 resolve-library-id react
```

Pass `--description` if you want a friendly summary in the generated help, or fall back to `--server '{...}'` when you need headers, env vars, or stdio commands.

If you omit `--name`, mcporter infers one from the command URL (for example, `https://mcp.context7.com/mcp` becomes `context7`).

The command writes `context7.ts` alongside a compiled `context7` binary. Generated CLIs embed the discovered schemas, so subsequent executions skip `listTools` round-trips and hit the network only for real tool calls. Use `--bundle` without a value to auto-name the output, and pass `--timeout` to raise the per-call default (30s). Add `--minify` to shrink bundled output. Compilation currently requires Bun; `--compile [path]` runs `bun build --compile` to emit a native executable, and when you omit the path the binary inherits the server name (`context7` in the example) so you can drop it straight onto your PATH.

> Tip: When Bun (or `BUN_BIN`) is available, `mcporter` defaults to `--runtime bun`; otherwise it falls back to Node. Pass `--runtime node` or `--runtime bun` to override explicitly.

## Composable Workflows

The package exports a thin runtime that lets you compose multiple MCP calls and post-process the results entirely in TypeScript. The example in `examples/context7-headlines.ts` demonstrates how to:

1. Resolve a library ID with `context7.resolve-library-id`
2. Fetch the docs via `context7.get-library-docs`
3. Derive a summary (markdown headings) locally

Use the pattern to build richer automations—batch fetch docs, search with Context7, or pass results into another MCP server without shelling out to the CLI.

Prefer the `createServerProxy` helper when you want an ergonomic proxy object for a server:

```ts
import { createRuntime, createServerProxy } from "mcporter";

const mcpRuntime = await createRuntime({
	servers: [
		{
			name: "context7",
			description: "Context7 docs MCP",
			command: {
				kind: "http",
				url: new URL("https://mcp.context7.com/mcp"),
				headers: process.env.CONTEXT7_API_KEY
					? { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
					: undefined,
			},
		},
	],
});
// Inline definitions work at runtime; move this block to config/mcporter.json if you prefer static config.

const context7 = createServerProxy(mcpRuntime, "context7");

const search = await context7.resolveLibraryId("react");
const docs = await context7.getLibraryDocs("react"); // maps to required schema fields

console.log(search.text()); // "Available Libraries ..."
console.log(docs.markdown()); // markdown excerpt

await mcpRuntime.close();
```

Every property access maps from camelCase to the underlying tool name automatically (`resolveLibraryId` → `resolve-library-id`). Beyond method names, the proxy:

- merges JSON-schema defaults so you only specify overrides;
- validates required arguments and throws helpful errors when fields are missing;
- returns a `CallResult` wrapper with `.raw`, `.text()`, `.markdown()`, `.json()`, and other helpers for quick post-processing.
- accepts primitives, tuples, or plain objects and routes them onto required schema fields in order (multi-argument tools like Firecrawl’s `scrape` work with positional calls);

```ts
const firecrawl = createServerProxy(mcpRuntime, "firecrawl");
await firecrawl.firecrawlScrape(
	"https://example.com/docs",
	["markdown", "html"], // 2nd required/optional field from schema
	{ waitFor: 5000 }, // merged as args
	{ tailLog: true }, // treated as call options
);
```

You can still drop down to `context7.call("resolve-library-id", { args: { ... } })` when you need explicit control.

### Compose higher-level flows

Because the proxy already maps positional arguments to schema fields, you can layer custom helpers with plain JavaScript:

```ts
const context7 = createServerProxy(mcpRuntime, "context7");

async function getDocs(libraryName: string) {
	const resolved = await context7.resolveLibraryId(libraryName);
	const id =
		resolved
			.json<{ candidates?: Array<{ context7CompatibleLibraryID?: string }> }>()
			?.candidates?.find((candidate) => candidate?.context7CompatibleLibraryID)
			?.context7CompatibleLibraryID ??
		resolved.text()?.match(/Context7-compatible library ID:\s*([^\s]+)/)?.[1];
	if (!id) {
		throw new Error(`Context7 library "${libraryName}" not found.`);
	}
	return context7.getLibraryDocs(id);
}

const docs = await getDocs("react");
console.log(docs.markdown());
```

The return value is still a `CallResult`, so you retain `.text()`, `.markdown()`, `.json()`, and friends.

## Configuration

Define your servers in `config/mcporter.json` using the same shape Cursor and Claude Code expect:

```jsonc
{
	"mcpServers": {
		"context7": {
			"description": "Context7 docs MCP",
			"baseUrl": "https://mcp.context7.com/mcp",
			"headers": {
				"Authorization": "$env:CONTEXT7_API_KEY"
			}
		},
		"chrome-devtools": {
			"command": "bash",
			"args": ["scripts/mcp_stdio_wrapper.sh", "env", "npx", "-y", "chrome-devtools-mcp@latest"]
		}
	},
	"imports": ["cursor", "claude-code", "claude-desktop", "codex"]
}
```

Fields you can use:

- `baseUrl` for HTTP/SSE servers.
- `command` + optional `args` for stdio servers.
- Optional metadata such as `description`, `headers`, `env`, `auth`, `tokenCacheDir`, and `clientName`.
- Convenience helpers `bearerToken` or `bearerTokenEnv` populate `Authorization` headers automatically.

If you omit the optional `imports` array, `mcporter` automatically merges Cursor, Claude Code, Claude Desktop, and Codex configs (first entry wins on conflicts). Set `"imports": []` to disable or provide a custom order such as `"imports": ["cursor", "codex"]`.

Pass a different path via `createRuntime({ configPath })` when you need multiple configs side by side.

## Testing & CI

| Command | Purpose |
| --- | --- |
| `pnpm check` | Biome lint/format check. |
| `pnpm build` | TypeScript compilation (emits `dist/`). |
| `pnpm test` | Vitest unit + integration suites (includes a streamable HTTP MCP fixture). |

GitHub Actions (`.github/workflows/ci.yml`) runs the same trio on every push and pull request.

## Roadmap

- Smoother OAuth UX (`mcporter auth <server>`, timeout warnings).
- Tailing for streaming `structuredContent`, not just file paths.
- Optional code generation for high-frequency tool schemas.
- Automated release tooling (changelog, tagged publishes).

For deeper architectural notes, see [`docs/spec.md`](docs/spec.md).

## License

MIT — see [LICENSE](LICENSE).
