// Implements the @modelcontextprotocol/sdk OAuthClientProvider interface
// against the local ~/.mcp-auth disk store, with the local callback server
// supplying the redirect URL.

import open from 'open'
import {
  readJsonFile,
  writeJsonFile,
  readTextFile,
  writeTextFile,
  deleteFileIfExists,
} from './mcp-auth-config.js'
import { log, MCP_REMOTE_VERSION } from './utils.js'

const CLIENT_INFO_FILE = 'client_info.json'
const TOKENS_FILE = 'tokens.json'
const VERIFIER_FILE = 'code_verifier.txt'

export class NodeOAuthClientProvider {
  /**
   * @param {{
   *   serverUrl: string,
   *   serverHash: string,
   *   callbackPort: number,
   *   host: string,
   *   clientName?: string,
   *   staticOAuthClientMetadata?: object|null,
   *   staticOAuthClientInfo?: object|null,
   *   onAuthorize?: (url: URL) => Promise<void>,
   * }} opts
   */
  constructor(opts) {
    this.opts = opts
    this._softwareId = 'fc-remote'
    this._softwareVersion = MCP_REMOTE_VERSION
  }

  // The redirect URL the local callback server is listening on.
  get redirectUrl() {
    return `http://${this.opts.host}:${this.opts.callbackPort}/oauth/callback`
  }

  // Default client metadata used during Dynamic Client Registration.
  // Overridable via --static-oauth-client-metadata.
  get clientMetadata() {
    const base = {
      client_name: this.opts.clientName || 'fc-remote',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      software_id: this._softwareId,
      software_version: this._softwareVersion,
    }
    return { ...base, ...(this.opts.staticOAuthClientMetadata || {}) }
  }

  async clientInformation() {
    if (this.opts.staticOAuthClientInfo) return this.opts.staticOAuthClientInfo
    return (await readJsonFile(this.opts.serverHash, CLIENT_INFO_FILE)) || undefined
  }

  async saveClientInformation(info) {
    if (this.opts.staticOAuthClientInfo) return // pinned by user — don't overwrite
    await writeJsonFile(this.opts.serverHash, CLIENT_INFO_FILE, info)
  }

  async tokens() {
    return (await readJsonFile(this.opts.serverHash, TOKENS_FILE)) || undefined
  }

  async saveTokens(tokens) {
    await writeJsonFile(this.opts.serverHash, TOKENS_FILE, tokens)
  }

  async codeVerifier() {
    const v = await readTextFile(this.opts.serverHash, VERIFIER_FILE)
    if (!v) throw new Error('No PKCE code_verifier on disk — authorization not in flight')
    return v
  }

  async saveCodeVerifier(verifier) {
    await writeTextFile(this.opts.serverHash, VERIFIER_FILE, verifier)
  }

  async invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') {
      await deleteFileIfExists(this.opts.serverHash, TOKENS_FILE)
    }
    if (scope === 'all' || scope === 'client') {
      await deleteFileIfExists(this.opts.serverHash, CLIENT_INFO_FILE)
    }
    if (scope === 'all' || scope === 'verifier') {
      await deleteFileIfExists(this.opts.serverHash, VERIFIER_FILE)
    }
  }

  // Called by the SDK to launch the user's browser at the authorize URL.
  async redirectToAuthorization(authorizationUrl) {
    log(`Opening browser for OAuth: ${authorizationUrl}`)
    if (this.opts.onAuthorize) await this.opts.onAuthorize(authorizationUrl)
    try {
      await open(authorizationUrl.toString())
    } catch (e) {
      log(`Could not open browser automatically (${e.message}).`)
      log(`Open this URL manually:\n${authorizationUrl}`)
    }
  }
}
