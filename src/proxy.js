// Bidirectional MCP proxy: local stdio  ⇄  remote (HTTP/SSE + OAuth).
//
// Architecture (mirrors mcp-remote):
//   stdio client ──▶ StdioServerTransport ──▶ proxy ──▶ remote transport
//                                                ▲
//                                                └── tool-name filter (--ignore-tool)

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { connectWithAuth } from './lib/auth-flow.js'
import {
  MCP_REMOTE_VERSION,
  globToRegExp,
  log,
  setDebugPath,
  setSilent,
  getServerUrlHash,
  validateServerUrl,
} from './lib/utils.js'
import { getDebugLogPath } from './lib/mcp-auth-config.js'

/**
 * @param {ReturnType<import('./lib/utils.js').parseArgs>} cfg
 */
export async function runProxy(cfg) {
  const url = validateServerUrl(cfg.serverUrl, cfg.allowHttp)
  const serverHash = getServerUrlHash(url.toString())

  setSilent(cfg.silent)
  if (cfg.debug) setDebugPath(getDebugLogPath(serverHash))

  if (cfg.enableProxy) {
    // Honour HTTP(S)_PROXY for fetch via undici's global agent (Node 18+).
    await maybeWireProxy()
  }

  const ignoreRegexes = cfg.ignoreToolPatterns.map(globToRegExp)
  log(`Using transport strategy: ${cfg.transportStrategy}`)
  log(`Using callback port: ${cfg.callbackPort === 0 ? 'auto (lazy)' : cfg.callbackPort}`)
  if (Object.keys(cfg.headers).length > 0) {
    log(`Using custom headers: ${JSON.stringify(cfg.headers)}`)
  }

  // 1. Build remote client and connect (with OAuth if needed).
  const remote = new Client(
    { name: 'fc-remote', version: MCP_REMOTE_VERSION },
    { capabilities: { sampling: {}, roots: { listChanged: true } } },
  )

  await connectWithAuth(remote, {
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

  const remoteCaps = remote.getServerCapabilities() || {}
  log(`Remote capabilities: [${Object.keys(remoteCaps).join(', ')}]`)

  // 2. Build local stdio MCP server that forwards every request to the remote.
  const local = new Server(
    { name: 'fc-remote-proxy', version: MCP_REMOTE_VERSION },
    { capabilities: remoteCaps },
  )

  if (remoteCaps.tools) {
    local.setRequestHandler(ListToolsRequestSchema, async (req) => {
      const r = await remote.listTools(req.params)
      return { ...r, tools: r.tools.filter((t) => !ignoreRegexes.some((re) => re.test(t.name))) }
    })
    local.setRequestHandler(CallToolRequestSchema, async (req) => {
      if (ignoreRegexes.some((re) => re.test(req.params.name))) {
        throw new Error(`Tool "${req.params.name}" is filtered by --ignore-tool`)
      }
      return remote.callTool(req.params)
    })
  }

  if (remoteCaps.resources) {
    local.setRequestHandler(ListResourcesRequestSchema, (req) => remote.listResources(req.params))
    local.setRequestHandler(ReadResourceRequestSchema, (req) => remote.readResource(req.params))
  }

  if (remoteCaps.prompts) {
    local.setRequestHandler(ListPromptsRequestSchema, (req) => remote.listPrompts(req.params))
    local.setRequestHandler(GetPromptRequestSchema, (req) => remote.getPrompt(req.params))
  }

  // 3. Forward notifications in both directions so list_changed et al. propagate.
  remote.fallbackNotificationHandler = async (n) => local.notification(n)
  local.fallbackNotificationHandler = async (n) => remote.notification(n)

  // 4. Bind stdio.
  const stdio = new StdioServerTransport()
  await local.connect(stdio)
  log('Local STDIO server running')
  log(`Proxy established successfully between local STDIO and remote ${remote.transport?.constructor?.name || 'transport'}`)
  log('Press Ctrl+C to exit')

  const shutdown = async (signal) => {
    log(`Received ${signal} — shutting down.`)
    try { await local.close() } catch {}
    try { await remote.close() } catch {}
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

async function maybeWireProxy() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (!proxyUrl) return
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
    log(`Using proxy ${proxyUrl}`)
  } catch (e) {
    log(`--enable-proxy requested but undici ProxyAgent unavailable: ${e.message}`)
  }
}
