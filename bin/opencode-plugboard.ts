#!/usr/bin/env bun
// `bunx opencode-plugboard init`: the command line entry. The logic is in src/cli.ts.
import { homedir } from "node:os"
import { runCli } from "../src/cli.js"
import { PACKAGE_VERSION } from "../src/version.js"

process.exitCode = runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env: process.env,
  home: homedir(),
  version: PACKAGE_VERSION,
})
