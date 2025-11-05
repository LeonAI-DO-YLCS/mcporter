# Changelog

## [Unreleased]

- Added non-blocking `mcporter list` output with per-server status and parallel discovery.
- Introduced `mcporter auth <server>` helper (and library API support) so OAuth flows don’t hang list calls.
- Set the default list timeout to 30 s (configurable via `MCP_LIST_TIMEOUT`).
- Tuned runtime connection handling to avoid launching OAuth flows when auto-authorization is disabled and to reuse cached clients safely.

## [0.1.0]

- Initial release.
