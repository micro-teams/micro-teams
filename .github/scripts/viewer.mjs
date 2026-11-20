// A person watching a live screen, for e2e.sh: it opens the backend's viewer WebSocket the way the
// app does — its size in the address, every chunk acknowledged as drawn (the machine stops sending
// to a viewer that does not) — and dials again a second after every close, as the app does. Each
// attach makes the backend wake the agent if it is known dead, so keeping a viewer attached
// through a connector restart is what puts the wake-up in the path of a restart.
//
// It records what a test needs to know into a file, one line per event:
//
//   open <n>             the n-th connection opened
//   data <n> <bytes>     the n-th connection received screen bytes (<bytes> so far); at most once
//                        a second, so a count of these lines rising means the screen is still
//                        reaching the viewer
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
  let bytes = 0
  let noted = 0
  const ws = new WebSocket(`${url}&cols=120&rows=32`)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    note(`open ${id}`)
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') return
    ws.send(JSON.stringify({ type: 'ack', n: ev.data.byteLength }))
    bytes += ev.data.byteLength
    if (Date.now() - noted >= 1000) {
      noted = Date.now()
      note(`data ${id} ${bytes}`)
    }
  }
  ws.onclose = (ev) => {
    note(`close ${id} ${ev.code}`)
    setTimeout(dial, 1000)
  }
  ws.onerror = () => {}
}
dial()
