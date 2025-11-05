#!/usr/bin/env node
import fs from "node:fs";
import { createRuntime } from "./runtime.js";

type FlagMap = Partial<Record<string, string>>;

// main parses CLI flags and dispatches to list/call commands.
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.length === 0) {
		printHelp();
		process.exit(1);
	}

	const globalFlags = extractFlags(argv, ["--config", "--root"]);
	const command = argv.shift();

	if (!command) {
		printHelp();
		process.exit(1);
	}

	const runtime = await createRuntime({
		configPath: globalFlags["--config"],
		rootDir: globalFlags["--root"],
	});

	if (command === "list") {
		await handleList(runtime, argv);
		return;
	}

	if (command === "call") {
		await handleCall(runtime, argv);
		return;
	}

	printHelp(`Unknown command '${command}'.`);
	process.exit(1);
}

// extractFlags snacks out targeted flags (and their values) from argv in place.
function extractFlags(args: string[], keys: string[]): FlagMap {
	const flags: FlagMap = {};
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		if (token === undefined || !keys.includes(token)) {
			index += 1;
			continue;
		}
		const value = args[index + 1];
		if (value === undefined) {
			throw new Error(`Flag '${token}' requires a value.`);
		}
		flags[token] = value;
		args.splice(index, 2);
	}
	return flags;
}

// handleList prints configured servers and optional tool metadata.
async function handleList(
	runtime: Awaited<ReturnType<typeof createRuntime>>,
	args: string[],
): Promise<void> {
	const flags = extractListFlags(args);
	const target = args.shift();

	if (!target) {
		for (const server of runtime.getDefinitions()) {
			const description = server.description ? ` — ${server.description}` : "";
			console.log(`- ${server.name}${description}`);
		}
		return;
	}

	const tools = await runtime.listTools(target, {
		includeSchema: flags.schema,
	});
	if (tools.length === 0) {
		console.log("  Tools: <none>");
		return;
	}
	console.log(`- ${target}`);
	console.log("  Tools:");
	for (const tool of tools) {
		const doc = tool.description ? `: ${tool.description}` : "";
		console.log(`    - ${tool.name}${doc}`);
		if (flags.schema && tool.inputSchema) {
			console.log(indent(JSON.stringify(tool.inputSchema, null, 2), "      "));
		}
	}
}

// handleCall invokes a tool, prints JSON, and optionally tails logs.
async function handleCall(
	runtime: Awaited<ReturnType<typeof createRuntime>>,
	args: string[],
): Promise<void> {
	const parsed = parseCallArguments(args);
	const selector = parsed.selector;
	let server = parsed.server;
	let tool = parsed.tool;

	if (selector && !server && selector.includes(".")) {
		const [left, right] = selector.split(".", 2);
		server = left;
		tool = right;
	} else if (selector && !server) {
		server = selector;
	} else if (selector && !tool) {
		tool = selector;
	}

	if (!server) {
		throw new Error(
			"Missing server name. Provide it via <server>.<tool> or --server.",
		);
	}
	if (!tool) {
		throw new Error(
			"Missing tool name. Provide it via <server>.<tool> or --tool.",
		);
	}

	const result = await runtime.callTool(server, tool, { args: parsed.args });

	if (typeof result === "string") {
		try {
			const decoded = JSON.parse(result);
			console.log(JSON.stringify(decoded, null, 2));
			tailLogIfRequested(decoded, parsed.tailLog ?? false);
		} catch {
			console.log(result);
			tailLogIfRequested(result, parsed.tailLog ?? false);
		}
		return;
	}

	console.log(JSON.stringify(result, null, 2));
	tailLogIfRequested(result, parsed.tailLog ?? false);
}

// extractListFlags captures list-specific options such as --schema.
function extractListFlags(args: string[]): { schema: boolean } {
	let schema = false;
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		if (token === "--schema") {
			schema = true;
			args.splice(index, 1);
			continue;
		}
		index += 1;
	}
	return { schema };
}

interface CallArgsParseResult {
	selector?: string;
	server?: string;
	tool?: string;
	args: Record<string, unknown>;
	tailLog?: boolean;
}

// parseCallArguments supports selectors, JSON payloads, and key=value args.
function parseCallArguments(args: string[]): CallArgsParseResult {
	const result: CallArgsParseResult = { args: {}, tailLog: false };
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		if (token === "--server" || token === "--mcp") {
			const value = args[index + 1];
			if (!value) {
				throw new Error(`Flag '${token}' requires a value.`);
			}
			result.server = value;
			args.splice(index, 2);
			continue;
		}
		if (token === "--tool") {
			const value = args[index + 1];
			if (!value) {
				throw new Error(`Flag '${token}' requires a value.`);
			}
			result.tool = value;
			args.splice(index, 2);
			continue;
		}
		if (token === "--args") {
			const value = args[index + 1];
			if (!value) {
				throw new Error("--args requires JSON payload.");
			}
			try {
				const decoded = JSON.parse(value);
				if (
					typeof decoded !== "object" ||
					decoded === null ||
					Array.isArray(decoded)
				) {
					throw new Error("--args must be a JSON object.");
				}
				Object.assign(result.args, decoded);
			} catch (error) {
				throw new Error(`Unable to parse --args: ${(error as Error).message}`);
			}
			args.splice(index, 2);
			continue;
		}
		if (token === "--tail-log") {
			result.tailLog = true;
			args.splice(index, 1);
			continue;
		}
		index += 1;
	}

	if (args.length > 0) {
		result.selector = args.shift();
	}
	for (const token of args) {
		const [key, raw] = token.split("=", 2);
		if (!key || raw === undefined) {
			throw new Error(`Argument '${token}' must be key=value format.`);
		}
		result.args[key] = coerceValue(raw);
	}
	return result;
}

// coerceValue tries to cast string tokens into JS primitives or JSON.
function coerceValue(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === "") {
		return "";
	}
	if (trimmed === "true" || trimmed === "false") {
		return trimmed === "true";
	}
	if (trimmed === "null" || trimmed === "none") {
		return null;
	}
	if (!Number.isNaN(Number(trimmed)) && trimmed === `${Number(trimmed)}`) {
		return Number(trimmed);
	}
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

// indent adds consistent left padding when printing nested JSON.
function indent(text: string, pad: string): string {
	return text
		.split("\n")
		.map((line) => pad + line)
		.join("\n");
}

// tailLogIfRequested prints the final lines of any referenced log files.
function tailLogIfRequested(result: unknown, enabled: boolean): void {
	if (!enabled) {
		return;
	}
	const candidates: string[] = [];
	if (typeof result === "string") {
		const idx = result.indexOf(":");
		if (idx !== -1) {
			const candidate = result.slice(idx + 1).trim();
			if (candidate) {
				candidates.push(candidate);
			}
		}
	}
	if (result && typeof result === "object") {
		const possibleKeys = ["logPath", "logFile", "logfile", "path"];
		for (const key of possibleKeys) {
			const value = (result as Record<string, unknown>)[key];
			if (typeof value === "string") {
				candidates.push(value);
			}
		}
	}

	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) {
			console.warn(`[warn] Log path not found: ${candidate}`);
			continue;
		}
		try {
			const content = fs.readFileSync(candidate, "utf8");
			const lines = content.trimEnd().split(/\r?\n/);
			const tail = lines.slice(-20);
			console.log(`--- tail ${candidate} ---`);
			for (const line of tail) {
				console.log(line);
			}
		} catch (error) {
			console.warn(
				`[warn] Failed to read log file ${candidate}: ${(error as Error).message}`,
			);
		}
	}
}

// printHelp explains available commands and global flags.
function printHelp(message?: string): void {
	if (message) {
		console.error(message);
		console.error("");
	}
	console.error(`Usage: mcp-runtime <command> [options]

Commands:
  list [name] [--schema]             List configured MCP servers (and tools for a server)
  call [selector] [flags]            Call a tool (selector like server.tool)
    --tail-log                       Tail log output when the tool returns a log file path

Global flags:
  --config <path>                    Path to mcp_servers.json (defaults to ./config/mcp_servers.json)
  --root <path>                      Root directory for stdio command cwd
`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
