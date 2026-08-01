// Take the screen drivers from the shared package instead of building our own.
//
// They are the same files every product built on this connector serves — understanding a coding
// agent's terminal is expensive, goes stale with every release of that agent, and is therefore
// maintained once, in micro-connector, and published. Copying them here rather than building them
// is the point: what ships is the artifact that repository tested, not a rebuild of it.
//
// The one thing MicroTeams still does to them happens at serve time, not here: the codex driver
// carries a placeholder for the standing operator instructions, which the backend substitutes.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
mkdirSync('dist', { recursive: true })

for (const name of ['claude', 'codex']) {
  const from = require.resolve(`@micro-teams/connector-applets/dist/${name}.js`)
  copyFileSync(from, `dist/${name}.js`)
  console.log(`screen driver: ${name}.js <- @micro-teams/connector-applets`)
}
