// Local HTTP server that captures the OAuth `?code=...` redirect.

import http from 'node:http'
import { log } from './utils.js'

/**
 * Start a one-shot HTTP server that resolves with the authorization code.
 * @param {{ host: string, port: number, timeoutSec: number }} opts
 * @returns {{ port: number, codePromise: Promise<string>, close: () => void }}
 */
export function startCallbackServer({ host, port, timeoutSec }) {
  let resolveCode
  let rejectCode
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname !== '/oauth/callback') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not Found')
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (error) {
      res.writeHead(400, { 'content-type': 'text/html' })
      res.end(`<h1>OAuth error</h1><p>${escapeHtml(error)}</p>`)
      rejectCode(new Error(`OAuth error: ${error}`))
      return
    }
    if (!code) {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('Missing ?code')
      rejectCode(new Error('OAuth callback missing ?code'))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      `<!doctype html><meta charset="utf-8"><title>fc-remote</title>` +
        `<h1>Authorized</h1><p>You can close this tab and return to your terminal.</p>` +
        `<script>setTimeout(()=>window.close(),500)</script>`,
    )
    resolveCode(code)
  })

  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(port, host, () => {
      const actualPort = server.address().port
      log(`OAuth callback listening on http://${host}:${actualPort}/oauth/callback`)

      const timer = setTimeout(() => {
        rejectCode(new Error(`OAuth callback timed out after ${timeoutSec}s`))
      }, timeoutSec * 1000)
      codePromise.finally(() => clearTimeout(timer))

      resolveStart({
        port: actualPort,
        codePromise,
        close: () => server.close(),
      })
    })
  })
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}
