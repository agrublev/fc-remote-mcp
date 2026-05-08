// `fc-remote-client` — diagnostic. Runs the full auth flow then prints
// the tools and resources advertised by the remote server.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { connectWithAuth } from './lib/auth-flow.js'
import {
  MCP_REMOTE_VERSION,
  log,
  setDebugPath,
  setSilent,
  getServerUrlHash,
  validateServerUrl,
} from './lib/utils.js'
import { getDebugLogPath } from './lib/mcp-auth-config.js'

export async function runClient(cfg) {
  const url = validateServerUrl(cfg.serverUrl, cfg.allowHttp)
  const serverHash = getServerUrlHash(url.toString())

  setSilent(cfg.silent)
  if (cfg.debug) setDebugPath(getDebugLogPath(serverHash))

  const client = new Client(
    { name: 'fc-remote-client', version: MCP_REMOTE_VERSION },
    { capabilities: {} },
  )

  await connectWithAuth(client, {
    url,
    serverHash,
    strategy: cfg.transportStrategy,
    headers: cfg.headers,
    callbackPort: cfg.callbackPort,
    host: cfg.host,
    authTimeoutSec: cfg.authTimeoutSec,
    resource: cfg.resource,
    staticOAuthClientMetadata: cfg.staticOAuthClientMetadata,
    staticOAuthClientInfo: cfg.staticOAuthClientInfo,
  })

  const caps = client.getServerCapabilities() || {}
  log('Connected. Capabilities:', Object.keys(caps))

  const out = process.stdout
  if (caps.tools) {
    const r = await client.listTools()
    out.write(`\n# Tools (${r.tools.length})\n`)
    for (const t of r.tools) out.write(`- ${t.name}${t.description ? ` — ${t.description}` : ''}\n`)
  }
  if (caps.resources) {
    const r = await client.listResources()
    out.write(`\n# Resources (${r.resources.length})\n`)
    for (const res of r.resources) out.write(`- ${res.uri}${res.name ? `  (${res.name})` : ''}\n`)
  }
  if (caps.prompts) {
    const r = await client.listPrompts()
    out.write(`\n# Prompts (${r.prompts.length})\n`)
    for (const p of r.prompts) out.write(`- ${p.name}${p.description ? ` — ${p.description}` : ''}\n`)
  }

  await client.close()
}
