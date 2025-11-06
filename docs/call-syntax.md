# Call Syntax Reference

`mcporter call` now understands two complementary styles:

| Style | Example | Notes |
|-------|---------|-------|
| Flag-based (compatible) | `mcporter call linear.create_comment --issue-id LNR-123 --body "Hi"` | Great for shell scripts and backwards compatibility. |
| Function-call (expressive) | `mcporter call 'linear.create_comment(issueId: "LNR-123", body: "Hi")'` | Mirrors the pseudo-TypeScript signature shown by `mcporter list`. |

Both forms share the same validation pipeline, so required parameters, enums, and formats behave identically.

## Reading the CLI Signatures

`mcporter list <server>` prints each tool as a compact TypeScript declaration:

```ts
/**
 * Create a comment on a specific Linear issue.
 * @param issueId The issue ID
 * @param body The content of the comment as Markdown
 * @param parentId? A parent comment ID to reply to
 */
function create_comment(issueId: string, body: string, parentId?: string): Comment;
// optional (3): notifySubscribers, labelIds, mentionIds, ...
```

Key details:

- Doc blocks use `@param` lines so every parameter description (even optional ones) stays in view.
- Required parameters appear without `?`; optional parameters use `?` and inherit enum literals (e.g. `"json" | "markdown"`).
- Known format hints are appended inline: `dueDate?: string /* ISO 8601 */` (we suppress the hint when the description already calls it out).
- When a tool exposes more than two optional parameters (or has ≥4 required parameters), the default output hides the extras and replaces them with an inline summary like `// optional (8): limit, before, after, orderBy, projectId, ...`.
- Run `mcporter list <server> --include-optional` whenever you want the full signature; the footer repeats `Optional parameters hidden; run with --include-optional to view all fields.` any time truncation occurs.
- Return types come from each tool’s output schema, so you’ll see concrete names when providers include `title` metadata (e.g. `DocumentConnection`). When no schema is advertised we omit the `: Type` suffix entirely instead of showing `unknown`.
- Each server concludes with a short `Examples:` block that mirrors the preferred function-call syntax.

## Function-Call Syntax Details

- **Named arguments only**: `issueId: "123"` is required; positional arguments are rejected so we can reliably map schema names.
- **Literals supported**: strings, numbers, booleans, `null`, arrays, and nested objects. For strings containing spaces or commas, wrap the entire call in single quotes to keep the shell happy.
- **Error feedback**: invalid keys, unsupported expressions, or parser failures bubble up with actionable messages (`Unsupported argument expression: Identifier`, `Unable to parse call expression: …`).
- **Server selection**: You can embed the server in the expression (`linear.create_comment(...)`) or pass it separately (`--server linear create_comment(...)`).

## Tips

- Use `--args '{ "issueId": "LNR-123" }'` if you already have JSON payloads—nothing changed for that workflow.
- The new syntax respects all existing features (timeouts, `--output`, auto-correction).
- Required fields show by default; pass `--include-optional` when you want the full parameter list (or `--schema` for raw JSON schemas).
- When in doubt, run `mcporter list <server>` to see the current signature and sample invocation.
