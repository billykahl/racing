import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { tracks, TOTAL_LAPS, MAX_PLAYERS } from './shared/track.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 8765)
const LOBBY_SEC = +(process.env.LOBBY_SEC || 30)      // countdown once the first racer joins
const COUNTDOWN_SEC = +(process.env.COUNTDOWN_SEC || 4) // grid lock + lights
const RESULTS_SEC = +(process.env.RESULTS_SEC || 10)
const GRACE_SEC = +(process.env.GRACE_SEC || 30)      // time the rest get once the leader finishes
const HARD_CAP_SEC = +(process.env.HARD_CAP_SEC || 300)
const TICK_MS = 50

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#00acc1', '#ec407a', '#f5f5f5', '#546e7a', '#7cb342', '#ffb300', '#3949ab', '#d81b60']
const NAMES = ['Flash', 'Turbo', 'Blitz', 'Rocket', 'Nova', 'Comet', 'Viper', 'Ghost', 'Storm', 'Pixel', 'Mach', 'Drift', 'Bolt', 'Zippy']
const NAME_MAX = 14

// Printable characters only, no markup, collapsed whitespace, capped length.
function cleanName (raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
}

// A racer's name is frozen from the moment the grid locks (countdown) until
// the results board clears; spectators can rename whenever they like.
function nameLocked (c) {
  return c.inRace && state.phase !== 'lobby'
}

const pubDir = path.join(__dirname, 'public')
const sharedDir = path.join(__dirname, 'shared')
const threeDir = path.join(__dirname, 'node_modules', 'three')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json'
}

function serveFrom (root, rel, res) {
  const file = path.normalize(path.join(root, rel))
  if (!file.startsWith(root)) {
    res.writeHead(403)
    return res.end()
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      return res.end('not found')
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': root === threeDir ? 'public, max-age=86400' : 'no-cache'
    })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/') p = '/index.html'
  if (p.startsWith('/vendor/three/')) return serveFrom(threeDir, p.slice('/vendor/three/'.length), res)
  if (p.startsWith('/shared/')) return serveFrom(sharedDir, p.slice('/shared/'.length), res)
  serveFrom(pubDir, p, res)
})

const wss = new WebSocketServer({ server })

let nextId = 1
let nextColor = 0
const clients = new Map()
let roster = [] // ids of racers, in grid order

const state = {
  phase: 'lobby',
  phaseEnds: null, // null while the lobby waits for the first racer
  raceStart: 0,
  graceStart: null,
  results: null
}

const trackOrder = [...tracks.keys()]
for (let i = trackOrder.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[trackOrder[i], trackOrder[j]] = [trackOrder[j], trackOrder[i]]
}
let trackPtr = 0
let track = tracks[trackOrder[0]]

function nextTrack () {
  trackPtr = (trackPtr + 1) % tracks.length
  track = tracks[trackOrder[trackPtr]]
  console.log('[map-switch]', new Date().toISOString(), '->', track.name, 'clients:', clients.size)
  broadcast({ t: 'map', name: track.name })
}

function broadcast (obj) {
  const data = JSON.stringify(obj)
  for (const c of clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(data)
  }
}

function resetCar (c, slot) {
  const g = track.gridPose(slot)
  c.slot = slot
  c.car.x = g.x
  c.car.z = g.z
  c.car.a = g.a
  c.car.lap = 0
  c.car.prog = 0
  c.car.fin = false
  c.car.finT = 0
  c.car.spd = 0
  c.car.flags = 0
  c.moved = false
}

function score (c) {
  return c.car.lap + c.car.prog
}

function finishRace () {
  const now = Date.now()
  const racers = roster.map(id => clients.get(id)).filter(Boolean)
  racers.sort((a, b) => {
    if (a.car.fin && b.car.fin) return a.car.finT - b.car.finT
    if (a.car.fin) return -1
    if (b.car.fin) return 1
    return score(b) - score(a)
  })
  state.results = racers.map((c, i) => ({
    pos: i + 1,
    id: c.id,
    name: c.name,
    color: COLORS[c.colorIdx],
    time: c.car.fin ? c.car.finT : 0,
    laps: c.car.lap
  }))
  state.phase = 'finished'
  state.phaseEnds = now + RESULTS_SEC * 1000
  console.log('[finish]', new Date().toISOString(), state.results.map(r => `${r.pos}.${r.name}${r.time ? '' : '(DNF)'}`).join(' '))
}

function openLobby () {
  const now = Date.now()
  state.phase = 'lobby'
  state.results = null
  state.graceStart = null
  // Racers who actually drove stay on the grid for the next race; idle ones
  // (dead keyboard, tabbed away) drop back to spectating.
  roster = roster.filter(id => {
    const c = clients.get(id)
    return c && c.moved
  })
  roster.forEach((id, i) => resetCar(clients.get(id), i))
  for (const c of clients.values()) c.inRace = roster.includes(c.id)
  state.phaseEnds = roster.length > 0 ? now + LOBBY_SEC * 1000 : null
  nextTrack()
}

function tick () {
  const now = Date.now()
  if (state.phase === 'lobby') {
    if (state.phaseEnds !== null && now >= state.phaseEnds) {
      if (roster.length > 0) {
        state.phase = 'countdown'
        state.phaseEnds = now + COUNTDOWN_SEC * 1000
      } else {
        state.phaseEnds = null
      }
    }
  } else if (state.phase === 'countdown' && now >= state.phaseEnds) {
    state.phase = 'racing'
    state.raceStart = now
    state.graceStart = null
    for (const id of roster) {
      const c = clients.get(id)
      if (!c) continue
      c.car.lap = 0
      c.car.prog = 0
      c.car.fin = false
      c.car.finT = 0
      c.moved = false
    }
    console.log('[race-start]', new Date().toISOString(), track.name, 'racers:', roster.length)
  } else if (state.phase === 'racing') {
    const racers = roster.map(id => clients.get(id)).filter(Boolean)
    if (racers.length === 0) {
      finishRace()
    } else {
      const allFin = racers.every(c => c.car.fin)
      const graceOver = state.graceStart !== null && now - state.graceStart >= GRACE_SEC * 1000
      const capOver = now - state.raceStart >= HARD_CAP_SEC * 1000
      if (allFin || graceOver || capOver) finishRace()
    }
  } else if (state.phase === 'finished' && now >= state.phaseEnds) {
    openLobby()
  }

  const cars = []
  roster.forEach((id, i) => {
    const c = clients.get(id)
    if (!c) return
    cars.push({
      id,
      si: i,
      n: c.name,
      col: COLORS[c.colorIdx],
      x: +c.car.x.toFixed(2),
      z: +c.car.z.toFixed(2),
      a: +c.car.a.toFixed(3),
      l: c.car.lap,
      p: +c.car.prog.toFixed(4),
      s: +c.car.spd.toFixed(1),
      f: c.car.flags,
      fin: c.car.fin ? 1 : 0
    })
  })
  broadcast({
    t: 'snap',
    ph: state.phase,
    tl: state.phaseEnds === null ? -1 : Math.max(0, (state.phaseEnds - now) / 1000),
    gl: state.phase === 'racing' && state.graceStart !== null ? Math.max(0, GRACE_SEC - (now - state.graceStart) / 1000) : -1,
    clock: state.phase === 'racing' ? now - state.raceStart : 0,
    cars,
    res: state.results
  })
}

wss.on('connection', ws => {
  const id = nextId++
  const name = NAMES[(id - 1) % NAMES.length] + '-' + String(100 + Math.floor(Math.random() * 900))
  const c = {
    ws,
    id,
    name,
    colorIdx: nextColor++ % COLORS.length,
    inRace: false,
    moved: false,
    slot: -1,
    car: { x: 0, z: 0, a: 0, lap: 0, prog: 0, fin: false, finT: 0, spd: 0, flags: 0 }
  }
  clients.set(id, c)

  ws.send(JSON.stringify({
    t: 'init',
    id,
    name: c.name,
    color: COLORS[c.colorIdx],
    nameMax: NAME_MAX,
    laps: TOTAL_LAPS,
    maxPlayers: MAX_PLAYERS,
    mapName: track.name,
    lobbySec: LOBBY_SEC,
    graceSec: GRACE_SEC,
    ph: state.phase,
    tl: state.phaseEnds === null ? -1 : Math.max(0, (state.phaseEnds - Date.now()) / 1000)
  }))

  ws.on('message', raw => {
    let m
    try {
      m = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (m.t === 'join') {
      if (state.phase !== 'lobby') {
        ws.send(JSON.stringify({ t: 'joined', ok: false, why: state.phase === 'finished' ? 'Results are showing — next lobby opens in a moment!' : 'Race in progress — you can join the next one!' }))
        return
      }
      if (c.inRace) return
      if (roster.length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'joined', ok: false, why: 'Race is full (14/14)!' }))
        return
      }
      c.inRace = true
      roster.push(id)
      resetCar(c, roster.length - 1)
      if (state.phaseEnds === null) state.phaseEnds = Date.now() + LOBBY_SEC * 1000
      ws.send(JSON.stringify({ t: 'joined', ok: true, slot: c.slot }))
      console.log('[join]', c.name, 'slot', c.slot, 'roster', roster.length)
    } else if (m.t === 'name') {
      if (nameLocked(c)) {
        ws.send(JSON.stringify({ t: 'named', ok: false, name: c.name, why: 'Names are locked once the race starts' }))
        return
      }
      const n = cleanName(m.name)
      if (!n) {
        ws.send(JSON.stringify({ t: 'named', ok: false, name: c.name, why: 'Pick a name with at least one letter' }))
        return
      }
      if (n !== c.name) {
        console.log('[rename]', c.name, '->', n)
        c.name = n
      }
      ws.send(JSON.stringify({ t: 'named', ok: true, name: c.name }))
    } else if (m.t === 'leave') {
      if (!c.inRace || state.phase !== 'lobby') return
      dropFromRoster(c)
      ws.send(JSON.stringify({ t: 'left' }))
    } else if (m.t === 'st' && c.inRace && Array.isArray(m.q)) {
      const q = m.q
      c.car.x = +q[0] || 0
      c.car.z = +q[1] || 0
      c.car.a = +q[2] || 0
      c.car.spd = Math.max(0, +q[5] || 0)
      c.car.flags = (+q[6] | 0) & 15
      if (state.phase === 'racing') {
        if (c.car.spd > 1) c.moved = true
        if (+q[3] > c.car.lap) c.car.lap = Math.min(+q[3], TOTAL_LAPS)
        c.car.prog = Math.max(0, Math.min(1, +q[4] || 0))
        if (!c.car.fin && c.car.lap >= TOTAL_LAPS) {
          c.car.fin = true
          c.car.finT = Date.now() - state.raceStart
          if (state.graceStart === null) {
            state.graceStart = Date.now()
            console.log('[first-finish]', c.name, (c.car.finT / 1000).toFixed(1) + 's', '-> grace', GRACE_SEC + 's')
          }
        }
      }
    }
  })

  ws.on('close', () => {
    clients.delete(id)
    if (c.inRace) dropFromRoster(c)
  })
})

function dropFromRoster (c) {
  c.inRace = false
  const ri = roster.indexOf(c.id)
  if (ri !== -1) roster.splice(ri, 1)
  if (state.phase === 'lobby') {
    // Re-pack grid slots so there are no gaps.
    roster.forEach((id, i) => {
      const o = clients.get(id)
      if (o) resetCar(o, i)
    })
    if (roster.length === 0) state.phaseEnds = null
  }
}

const tickTimer = setInterval(tick, TICK_MS)

server.listen(PORT, () => {
  console.log(`Racing server on http://localhost:${PORT}`)
})

// Vercel (and docker stop) send SIGTERM on scale-down with a 30 s grace
// period; tell every client we are going away, close cleanly, then exit.
let shuttingDown = false
function shutdown (signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[shutdown]', new Date().toISOString(), signal, 'clients:', clients.size)
  clearInterval(tickTimer)
  for (const c of clients.values()) {
    if (c.ws.readyState === 1) c.ws.close(1001, 'server shutting down')
  }
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
