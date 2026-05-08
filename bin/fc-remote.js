#!/usr/bin/env node
// Entry point for the stdio↔remote MCP proxy.

import { parseArgs, printUsage, MCP_REMOTE_VERSION, log } from '../src/lib/utils.js'
import { runProxy } from '../src/proxy.js'

async function main() {
  let cfg
  try {
    cfg = parseArgs(process.argv)
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`)
    printUsage('fc-remote')
    process.exit(2)
  }
  if (cfg.help) { printUsage('fc-remote'); return }
  if (cfg.version) { process.stdout.write(`${MCP_REMOTE_VERSION}\n`); return }

  await runProxy(cfg)
}

main().catch((e) => {
  log(`Fatal: ${e?.stack || e?.message || e}`)
  process.exit(1)
})
