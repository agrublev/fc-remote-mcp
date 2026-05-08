// Persistent OAuth state storage under ~/.mcp-auth/<server-hash>/
// Layout (parallels mcp-remote):
//   client_info.json    — OAuthClientInformation (registered or static)
//   tokens.json         — OAuthTokens (access + refresh)
//   code_verifier.txt   — PKCE verifier for in-flight authorization
//   lock.json           — coordination lock (pid + callback port)

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export function getConfigDir() {
  return process.env.MCP_REMOTE_CONFIG_DIR || path.join(os.homedir(), '.mcp-auth')
}

export function getServerDir(serverHash) {
  return path.join(getConfigDir(), serverHash)
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
}

export async function readJsonFile(serverHash, name) {
  const file = path.join(getServerDir(serverHash), name)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

export async function writeJsonFile(serverHash, name, data) {
  const dir = getServerDir(serverHash)
  await ensureDir(dir)
  const file = path.join(dir, name)
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export async function readTextFile(serverHash, name) {
  const file = path.join(getServerDir(serverHash), name)
  try {
    return await fs.readFile(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

export async function writeTextFile(serverHash, name, text) {
  const dir = getServerDir(serverHash)
  await ensureDir(dir)
  const file = path.join(dir, name)
  await fs.writeFile(file, text, { mode: 0o600 })
}

export async function deleteFileIfExists(serverHash, name) {
  const file = path.join(getServerDir(serverHash), name)
  try {
    await fs.unlink(file)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}

export function getDebugLogPath(serverHash) {
  return path.join(getConfigDir(), `${serverHash}_debug.log`)
}
