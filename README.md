# fc-remote-mcp

Connect stdio-only MCP clients (Claude Desktop, Cursor, etc.) to remote MCP servers over HTTP/SSE — with optional OAuth or static auth headers. A lightweight clone of [`mcp-remote`](https://github.com/geelen/mcp-remote) tuned for Freedcamp's MCP server.

## Install

Run on demand with `npx` (no install required):

```bash
npx fc-remote-mcp <server-url> [options]
```

Or install globally:

```bash
npm install -g fc-remote-mcp
```

## Usage

```bash
fc-remote <server-url> [options]
```

### Options

- `--transport <mode>` — `http-only`, `sse-only`, or `auto` (default: `auto`)
- `--header "Name: value"` — add a custom header (repeatable). Use this to pass static API keys / secrets.
- `--allow-http` — permit non-HTTPS server URLs (for local dev)
- `--debug` — verbose logging to stderr
- `--help`, `--version`

### Example — Freedcamp with static API headers

```bash
npx fc-remote-mcp https://mcp.freedcamp.top/mcp \
  --transport http-only \
  --header "X-Freedcamp-Api-Key: <your-key>" \
  --header "X-Freedcamp-Api-Secret: <your-secret>"
```

### Example — OAuth-protected server

```bash
npx fc-remote-mcp https://example.com/mcp
```

A browser window will open for the OAuth login flow; tokens are cached under `~/.mcp-auth/`.

## Wire it into an MCP client

Most stdio MCP clients accept a JSON config like:

```json
{
  "mcpServers": {
    "freedcamp": {
      "command": "npx",
      "args": [
        "-y",
        "fc-remote-mcp",
        "https://mcp.freedcamp.top/mcp",
        "--transport", "http-only",
        "--header", "X-Freedcamp-Api-Key: <key>",
        "--header", "X-Freedcamp-Api-Secret: <secret>"
      ]
    }
  }
}
```

The proxy speaks stdio to the client and forwards every JSON-RPC message to the remote server.

## Diagnostic client

A standalone client is bundled to verify a remote server end-to-end without an MCP host:

```bash
npx -p fc-remote-mcp fc-remote-client <server-url> [options]
```

It connects, lists tools/resources/prompts, and exits.

## Requirements

- Node.js >= 18

## License

MIT
