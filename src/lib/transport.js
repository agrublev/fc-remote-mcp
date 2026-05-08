// Build the remote MCP transport according to the requested strategy.
// Falls back between Streamable HTTP and SSE per mcp-remote semantics:
//   http-first  → try HTTP, on 404 fall back to SSE
//   sse-first   → try SSE, on 405 fall back to HTTP
//   http-only   → HTTP only
//   sse-only    → SSE only

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { log } from './utils.js'

function buildHttpTransport(url, { authProvider, headers }) {
  return new StreamableHTTPClientTransport(url, {
    authProvider,
    requestInit: { headers },
  })
}

function buildSseTransport(url, { authProvider, headers }) {
  return new SSEClientTransport(url, {
    authProvider,
    requestInit: { headers },
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers || {}), ...headers } }) },
  })
}

/**
 * Connect a Client to the remote server using the chosen strategy.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @param {{ url: URL, strategy: string, authProvider: object, headers: Record<string,string> }} opts
 */
export async function connectWithStrategy(client, { url, strategy, authProvider, headers }) {
  const order =
    strategy === 'http-only' ? ['http']
    : strategy === 'sse-only' ? ['sse']
    : strategy === 'sse-first' ? ['sse', 'http']
    : ['http', 'sse']

  let lastErr
  for (const kind of order) {
    const transport =
      kind === 'http'
        ? buildHttpTransport(url, { authProvider, headers })
        : buildSseTransport(url, { authProvider, headers })
    try {
      await client.connect(transport)
      return { transport, used: kind }
    } catch (e) {
      lastErr = e
      const status = e?.status ?? e?.cause?.status
      const fallbackOnHttp404 = kind === 'http' && status === 404
      const fallbackOnSse405 = kind === 'sse' && status === 405
      if (fallbackOnHttp404 || fallbackOnSse405) {
        log(`${kind.toUpperCase()} transport returned ${status}; falling back.`)
        continue
      }
      throw e
    }
  }
  throw lastErr || new Error('No transport succeeded')
}
