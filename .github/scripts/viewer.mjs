// A person watching a live screen, for e2e.sh: it opens the backend's viewer WebSocket the way the
// app does, and dials again a second after every close, as the app does. Each attach makes the
// backend probe the agent and wake it if it looks dead, so keeping a viewer attached through a
// connector restart is what puts the wake-up in the path of a restart.
//
// It records what a test needs to know into a file, one line per event:
//
//   open <n>     the n-th connection opened
//   data <n>     the n-th connection received its first screen bytes
//   close <n> <code>
//
// Usage: node viewer.mjs <ws url> <log file>   (runs until killed)
import { appendFileSync } from 'node:fs'

const [url, log] = process.argv.slice(2)
if (!url || !log) {
  console.error('usage: node viewer.mjs <ws url> <log file>')
  process.exit(2)
}
const note = (line) => appendFileSync(log, line + '\n')

let n = 0
function dial() {
  const id = ++n
  let painted = false
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    note(`open ${id}`)
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 32 }))
  }
  ws.onmessage = (ev) => {
    if (!painted && typeof ev.data !== 'string' && ev.data.byteLength > 0) {
      painted = true
      note(`data ${id}`)
    }
  }
  ws.onclose = (ev) => {
    note(`close ${id} ${ev.code}`)
    setTimeout(dial, 1000)
  }
  ws.onerror = () => {}
}
dial()
