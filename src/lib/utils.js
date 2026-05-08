// Shared utilities: argument parsing, logging, hashing, version.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MCP_REMOTE_VERSION = (() => {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'package.json',
    )
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

let SILENT = false
let DEBUG_PATH = null

export function setSilent(v) {
  SILENT = !!v
}

export function setDebugPath(p) {
  DEBUG_PATH = p
}

// IMPORTANT: never write to stdout — stdout carries MCP protocol traffic.
export function log(...args) {
  const line = `[${process.pid}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`
  if (!SILENT) process.stderr.write(line + '\n')
  if (DEBUG_PATH) {
    try {
      fs.appendFileSync(DEBUG_PATH, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // ignore
    }
  }
}

export function debug(...args) {
  if (DEBUG_PATH) log('[debug]', ...args)
}

export function getServerUrlHash(serverUrl) {
  return crypto.createHash('sha256').update(serverUrl).digest('hex').slice(0, 16)
}

const TRANSPORT_STRATEGIES = new Set([
  'http-first',
  'sse-first',
  'http-only',
  'sse-only',
])

/**
 * Parse CLI arguments common to both `fc-remote` and `fc-remote-client`.
 * Returns: { serverUrl, callbackPort, headers, transportStrategy, host,
 *           authTimeoutSec, allowHttp, enableProxy, resource, ignoreToolPatterns,
 *           staticOAuthClientMetadata, staticOAuthClientInfo, debug, silent }
 */
export function parseArgs(argv) {
  const args = argv.slice(2)
  const out = {
    serverUrl: null,
    callbackPort: 0, // 0 → ephemeral
    headers: {},
    transportStrategy: 'http-first',
    host: 'localhost',
    authTimeoutSec: 30,
    allowHttp: false,
    enableProxy: false,
    resource: null,
    ignoreToolPatterns: [],
    staticOAuthClientMetadata: null,
    staticOAuthClientInfo: null,
    debug: false,
    silent: false,
  }

  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const next = () => {
      const v = args[++i]
      if (v === undefined) throw new Error(`Missing value for ${a}`)
      return v
    }
    switch (a) {
      case '--header':
        addHeader(out.headers, next())
        break
      case '--transport': {
        const v = next()
        if (!TRANSPORT_STRATEGIES.has(v)) {
          throw new Error(
            `Invalid --transport ${v}; expected one of ${[...TRANSPORT_STRATEGIES].join(', ')}`,
          )
        }
        out.transportStrategy = v
        break
      }
      case '--host':
        out.host = next()
        break
      case '--auth-timeout':
        out.authTimeoutSec = Number(next())
        break
      case '--allow-http':
        out.allowHttp = true
        break
      case '--enable-proxy':
        out.enableProxy = true
        break
      case '--resource':
        out.resource = next()
        break
      case '--ignore-tool':
        out.ignoreToolPatterns.push(next())
        break
      case '--static-oauth-client-metadata':
        out.staticOAuthClientMetadata = readJsonOrFile(next())
        break
      case '--static-oauth-client-info':
        out.staticOAuthClientInfo = readJsonOrFile(next())
        break
      case '--debug':
        out.debug = true
        break
      case '--silent':
        out.silent = true
        break
      case '-h':
      case '--help':
        out.help = true
        break
      case '-v':
      case '--version':
        out.version = true
        break
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`)
        positional.push(a)
    }
  }

  if (positional[0]) out.serverUrl = positional[0]
  if (positional[1]) {
    const port = Number(positional[1])
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid port: ${positional[1]}`)
    }
    out.callbackPort = port
  }
  return out
}

function addHeader(target, raw) {
  const idx = raw.indexOf(':')
  if (idx <= 0) throw new Error(`Bad --header "${raw}" (expected "Name: value")`)
  const name = raw.slice(0, idx).trim()
  const value = raw.slice(idx + 1).trim()
  target[name] = value
}

function readJsonOrFile(input) {
  let raw = input
  if (input.startsWith('@')) raw = fs.readFileSync(input.slice(1), 'utf8')
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}`)
  }
}

export function validateServerUrl(serverUrl, allowHttp) {
  if (!serverUrl) throw new Error('Missing server URL (first positional argument).')
  let url
  try {
    url = new URL(serverUrl)
  } catch {
    throw new Error(`Invalid URL: ${serverUrl}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }
  const isLocal =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.local')
  if (url.protocol === 'http:' && !isLocal && !allowHttp) {
    throw new Error('Refusing http:// for non-local host without --allow-http')
  }
  return url
}

export function printUsage(bin = 'fc-remote') {
  const usage = `\nUsage: ${bin} <server-url> [callback-port] [flags]\n\n` +
    `Flags:\n` +
    `  --header "Name: value"             Add header to remote requests (repeatable)\n` +
    `  --transport <strategy>             http-first|sse-first|http-only|sse-only (default: http-first)\n` +
    `  --host <hostname>                  OAuth callback host (default: localhost)\n` +
    `  --auth-timeout <seconds>           OAuth callback timeout (default: 30)\n` +
    `  --allow-http                       Allow http:// for non-local hosts (private nets only)\n` +
    `  --enable-proxy                     Honour HTTP_PROXY / HTTPS_PROXY / NO_PROXY\n` +
    `  --resource <url>                   Isolate OAuth session (multiple instances same server)\n` +
    `  --ignore-tool <pattern>            Hide tools matching pattern (wildcards: delete*)\n` +
    `  --static-oauth-client-metadata J   JSON or @file with client metadata\n` +
    `  --static-oauth-client-info J       JSON or @file with pre-registered client info\n` +
    `  --debug                            Verbose logs to ~/.mcp-auth/<hash>_debug.log\n` +
    `  --silent                           Suppress stderr logs\n` +
    `  -v, --version                      Print version\n` +
    `  -h, --help                         Print this help\n`
  process.stderr.write(usage)
}

// Build a glob → RegExp converter for --ignore-tool patterns (wildcards only).
export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}
