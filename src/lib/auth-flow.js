// Drives the MCP OAuth flow:
// 1. Try to connect with whatever credentials we have (headers + cached tokens).
// 2. If UnauthorizedError → spin up local callback server, run auth(),
//    wait for ?code=, exchange for tokens, retry connect.

import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { startCallbackServer } from './callback-server.js'
import { NodeOAuthClientProvider } from './node-oauth-client-provider.js'
import { connectWithStrategy } from './transport.js'
import { log } from './utils.js'

/**
 * Connect a client with OAuth-aware retry.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @param {{
 *   url: URL,
 *   serverHash: string,
 *   strategy: string,
 *   headers: Record<string,string>,
 *   callbackPort: number,
 *   host: string,
 *   authTimeoutSec: number,
 *   resource: string|null,
 *   staticOAuthClientMetadata?: object|null,
 *   staticOAuthClientInfo?: object|null,
 * }} opts
 */
export async function connectWithAuth(client, opts) {
  // First attempt: pre-construct a provider with the *requested* port. If the
  // request was 0 (ephemeral), we don't bind anything yet — the redirect URL
  // is only finalized once OAuth is actually triggered.
  let provider = new NodeOAuthClientProvider({
    serverUrl: opts.url.toString(),
    serverHash: opts.serverHash,
    callbackPort: opts.callbackPort,
    host: opts.host,
    staticOAuthClientMetadata: opts.staticOAuthClientMetadata,
    staticOAuthClientInfo: opts.staticOAuthClientInfo,
  })

  log(`Connecting to remote server: ${opts.url.toString()}`)
  log(`Using transport strategy: ${opts.strategy}`)

  try {
    const r = await connectWithStrategy(client, {
      url: opts.url,
      strategy: opts.strategy,
      authProvider: provider,
      headers: opts.headers,
    })
    log(`Connected to remote server using ${r.transport.constructor.name}`)
    return { ...r, provider }
  } catch (err) {
    if (!isUnauthorized(err)) throw err
  }

  // Auth required — bind the callback now and run the full dance.
  log('Server requires OAuth — starting authorization flow.')
  const cb = await startCallbackServer({
    host: opts.host,
    port: opts.callbackPort,
    timeoutSec: opts.authTimeoutSec,
  })

  // Re-create provider so the redirect URL reflects the actually-bound port.
  provider = new NodeOAuthClientProvider({
    serverUrl: opts.url.toString(),
    serverHash: opts.serverHash,
    callbackPort: cb.port,
    host: opts.host,
    staticOAuthClientMetadata: opts.staticOAuthClientMetadata,
    staticOAuthClientInfo: opts.staticOAuthClientInfo,
  })

  try {
    await auth(provider, {
      serverUrl: opts.url.toString(),
      ...(opts.resource ? { resource: opts.resource } : {}),
    })

    log(`Waiting for OAuth redirect (timeout ${opts.authTimeoutSec}s)…`)
    const code = await cb.codePromise

    log('Exchanging authorization code for tokens…')
    await auth(provider, {
      serverUrl: opts.url.toString(),
      authorizationCode: code,
      ...(opts.resource ? { resource: opts.resource } : {}),
    })

    log('Tokens obtained — reconnecting.')
    const r = await connectWithStrategy(client, {
      url: opts.url,
      strategy: opts.strategy,
      authProvider: provider,
      headers: opts.headers,
    })
    log(`Connected to remote server using ${r.transport.constructor.name}`)
    return { ...r, provider }
  } finally {
    cb.close()
  }
}

function isUnauthorized(err) {
  if (err instanceof UnauthorizedError) return true
  const status = err?.status ?? err?.cause?.status
  return status === 401
}
