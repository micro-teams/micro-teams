// Refresh the backend's TEST-classpath fallback copies of the applets. In production the backend
// reads applets from application.applets-dir (this module's dist/, mounted independently — not in
// the jar); these copies under src/test/resources exist only so the integration tests have applets
// on the classpath without needing that dir set. The applets module is the source of truth.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const copies = [
  ['dist/cli.js', '../backend/src/test/resources/applets/cli.js'],
  ['dist/claude.js', '../backend/src/test/resources/applets/claude.js'],
  ['dist/codex.js', '../backend/src/test/resources/applets/codex.js'],
]

for (const [from, to] of copies) {
  if (!existsSync(from)) continue
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  console.log(`copied ${from} -> ${to}`)
}
