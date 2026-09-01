import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { tracks, TOTAL_LAPS, MAX_PLAYERS } from './shared/track.js'
import { Coordinator, RECONCILE_MS } from './coord.js'
import { CAR_COLORS, CAR_STYLES, clampStyle, clampColor } from './shared/cars.js'
import { NAME_MAX, cleanName, nameProblem } from './shared/names.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 8765)
const LOBBY_SEC = +(process.env.LOBBY_SEC || 30)      // countdown once the first racer joins
const COUNTDOWN_SEC = +(process.env.COUNTDOWN_SEC || 4) // grid lock + lights
const RESULTS_SEC = +(process.env.RESULTS_SEC || 10)
const GRACE_SEC = +(process.env.GRACE_SEC || 30)      // time the rest get once the leader finishes
const HARD_CAP_SEC = +(process.env.HARD_CAP_SEC || 300)
// Map vote closes this long before the lobby countdown ends; capped so short
// test timers still leave a voting window.
const VOTE_CLOSE_SEC = Math.min(+(process.env.VOTE_CLOSE_SEC || 8), LOBBY_SEC * 0.4)
const TICK_MS = 50
// With a Redis URL set, every instance sharing that Redis presents one lobby
// (see coord.js). Unset: this process is the whole world, all in memory.
// Marketplace add-ons expose the URL under different names; take the first set.
const REDIS_VARS = ['REDIS_URL', 'KV_URL', 'UPSTASH_REDIS_URL', 'REDIS_TLS_URL', 'REDIS_PRIVATE_URL']
const REDIS_VAR = REDIS_VARS.find(k => process.env[k]) || null
const REDIS_URL = REDIS_VAR ? process.env[REDIS_VAR] : ''
const INSTANCE_ID = process.env.INSTANCE_ID || crypto.randomBytes(4).toString('hex')
const STARTED = Date.now()

const NAMES = ['Flash', 'Turbo', 'Blitz', 'Rocket', 'Nova', 'Comet', 'Viper', 'Ghost', 'Storm', 'Pixel', 'Mach', 'Drift', 'Bolt', 'Zippy']
// A racer's name and car are frozen from the moment the grid locks (countdown)
// until the results board clears; spectators can change them whenever they like.
function customLocked (c) {
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

// Operational view of this instance: is the world shared, who runs it, and
// what it looks like from here. A follower holds no state of its own, so it
// reads the leader's last written state from Redis (authoritative: false).
async function health () {
  const leader = !coord || coord.leader
  const local = [...clients.values()].filter(c => c.local)
  const rosterIds = new Set(roster)
  let ph = state.phase
  let ends = state.phaseEnds
  let trk = track.name
  if (!leader) {
    const meta = await coord.readMeta()
    ph = meta ? meta.ph : null
    ends = meta ? meta.phaseEnds : null
    trk = meta ? meta.track : null
  }
  return {
    instance: INSTANCE_ID,
    shared: !!coord,
    redisVar: REDIS_VAR,
    redis: coord ? coord.redis.status : 'n/a',
    leader,
    leaderId: coord ? coord.knownLeader : INSTANCE_ID,
    authoritative: leader,
    phase: ph,
    phaseEndsIn: ends === null || ends === undefined ? null : Math.max(0, Math.round((ends - Date.now()) / 100) / 10),
    track: trk,
    clients: local.length,
    spectators: local.filter(c => !rosterIds.has(c.id)).length,
    roster: roster.length,
    uptimeSec: Math.round((Date.now() - STARTED) / 1000)
  }
}

function serveHealth (res) {
  health().then(h => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(h))
  }, e => {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: e.message }))
  })
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/') p = '/index.html'
  if (p === '/health' || p === '/api/health') return serveHealth(res)
  if (p.startsWith('/vendor/three/')) return serveFrom(threeDir, p.slice('/vendor/three/'.length), res)
  if (p.startsWith('/shared/')) return serveFrom(sharedDir, p.slice('/shared/'.length), res)
  serveFrom(pubDir, p, res)
})

const wss = new WebSocketServer({ server })

let nextId = 1
let nextColor = 0
// id -> client. Entries with `local: true` own a real WebSocket. On the leader
// of a shared lobby the map also holds `local: false` entries for clients that
// live on other instances; their `ws` is a proxy that publishes replies.
const clients = new Map()
let roster = [] // ids of racers, in grid order

const state = {
  phase: 'lobby',
  phaseEnds: null, // null while the lobby waits for the first racer
  raceStart: 0,
  graceStart: null,
  results: null,
  votes: new Map(), // lobby map vote: clientId -> track index
  voteClosed: false, // set once the vote has been resolved for this lobby
  votePruneAt: 0 // leader failover: when to drop votes from clients that never re-announced
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

// ---------- lobby map vote ----------

function voteTally () {
  const tally = new Array(tracks.length).fill(0)
  for (const idx of state.votes.values()) tally[idx]++
  return tally
}

function trackIndexOf (m) {
  if (typeof m === 'number') return Number.isInteger(m) ? m : -1
  if (typeof m === 'string') return tracks.findIndex(t => t.name === m)
  return -1
}

// Runs once per lobby countdown, VOTE_CLOSE_SEC before it ends. Most votes
// win, ties are broken at random, no votes keeps the rotation's pick.
function resolveVote () {
  state.voteClosed = true
  const tally = voteTally()
  const max = Math.max(0, ...tally)
  const cur = tracks.indexOf(track)
  let win = cur
  if (max > 0) {
    const tied = []
    tally.forEach((n, i) => { if (n === max) tied.push(i) })
    win = tied[Math.floor(Math.random() * tied.length)]
  }
  console.log('[map-vote]', new Date().toISOString(), 'tally', tracks.map((t, i) => `${t.name}=${tally[i]}`).join(' '),
    '->', tracks[win].name, max === 0 ? '(no votes, rotation kept)' : win === cur ? '(current map)' : '')
  if (win === cur) return
  trackPtr = trackOrder.indexOf(win)
  track = tracks[win]
  roster.forEach((id, i) => {
    const c = clients.get(id)
    if (c) resetCar(c, i)
  })
  broadcast({ t: 'map', name: track.name })
}

// Vote fields for `snap`/`init`; empty outside the lobby to keep snaps small.
function voteFields (out) {
  if (state.phase !== 'lobby') return out
  out.votes = voteTally()
  out.voteOpen = !state.voteClosed
  out.mapIdx = tracks.indexOf(track)
  return out
}

function broadcast (obj) {
  const data = JSON.stringify(obj)
  for (const c of clients.values()) {
    if (c.local && c.ws.readyState === 1) c.ws.send(data)
  }
  if (coord) coord.queueBcast(data)
}

function makeClient (ws, id, name, colorIdx, local, inst, styleIdx = 0) {
  return {
    ws,
    id,
    name,
    colorIdx,
    styleIdx,
    local,
    inst, // instance hosting the socket (null until a remote client is heard from)
    seen: Date.now(),
    inRace: false,
    moved: false,
    slot: -1,
    car: { x: 0, z: 0, a: 0, lap: 0, prog: 0, fin: false, finT: 0, spd: 0, flags: 0 }
  }
}

// ws-shaped stand-in for a client on another instance: replies travel over
// Redis to whichever instance holds the socket.
function remoteWs (id) {
  return { readyState: 1, send: data => coord.reply(id, data), close () {} }
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
    color: CAR_COLORS[c.colorIdx],
    style: c.styleIdx,
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
  state.votes.clear()
  state.voteClosed = false
  nextTrack()
}

function tick () {
  if (coord && !coord.leader) return // followers only relay
  const now = Date.now()
  if (coord) sweepRemote(now)
  if (state.phase === 'lobby') {
    if (!state.voteClosed && state.phaseEnds !== null && now >= state.phaseEnds - VOTE_CLOSE_SEC * 1000) resolveVote()
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
      col: CAR_COLORS[c.colorIdx],
      sty: c.styleIdx,
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
  broadcast(voteFields({
    t: 'snap',
    ph: state.phase,
    tl: state.phaseEnds === null ? -1 : Math.max(0, (state.phaseEnds - now) / 1000),
    gl: state.phase === 'racing' && state.graceStart !== null ? Math.max(0, GRACE_SEC - (now - state.graceStart) / 1000) : -1,
    clock: state.phase === 'racing' ? now - state.raceStart : 0,
    cars,
    res: state.results
  }))
  const list = presence()
  const key = JSON.stringify(list)
  if (key !== lastWho || now - lastWhoAt >= WHO_MS) {
    lastWho = key
    lastWhoAt = now
    broadcast({ t: 'who', list })
  }
  if (coord) coord.afterTick(metaSnapshot())
}

// Everyone on the site as the leader sees it: racers in grid order, then
// spectators (including the ones whose sockets live on other instances).
// Sent whenever it changes and at least every WHO_MS so late relays converge.
const WHO_MS = 2000
let lastWho = ''
let lastWhoAt = 0
function presence () {
  const list = []
  const over = state.phase === 'finished'
  for (const id of roster) {
    const c = clients.get(id)
    if (!c) continue
    const st = over || c.car.fin ? 'fin' : state.phase === 'racing' ? 'race' : 'grid'
    list.push({ id: c.id, n: c.name, col: CAR_COLORS[c.colorIdx], st, l: c.car.lap, fin: c.car.fin ? 1 : 0 })
  }
  const rosterIds = new Set(roster)
  const specs = [...clients.values()].filter(c => !rosterIds.has(c.id)).sort((a, b) => a.id - b.id)
  for (const c of specs) list.push({ id: c.id, n: c.name, col: CAR_COLORS[c.colorIdx], st: 'spec', l: 0, fin: 0 })
  return list
}

function handleMessage (c, m) {
  const ws = c.ws
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
    roster.push(c.id)
    resetCar(c, roster.length - 1)
    if (state.phaseEnds === null) state.phaseEnds = Date.now() + LOBBY_SEC * 1000
    ws.send(JSON.stringify({ t: 'joined', ok: true, slot: c.slot }))
    console.log('[join]', c.name, 'slot', c.slot, 'roster', roster.length)
  } else if (m.t === 'name') {
    if (customLocked(c)) {
      ws.send(JSON.stringify({ t: 'named', ok: false, name: c.name, why: 'Names are locked once the race starts' }))
      return
    }
    const n = cleanName(m.name)
    const why = nameProblem(n)
    if (why) {
      ws.send(JSON.stringify({ t: 'named', ok: false, name: c.name, why }))
      return
    }
    if (n !== c.name) {
      console.log('[rename]', c.name, '->', n)
      c.name = n
    }
    ws.send(JSON.stringify({ t: 'named', ok: true, name: c.name }))
  } else if (m.t === 'car') {
    if (customLocked(c)) {
      ws.send(JSON.stringify({ t: 'car', ok: false, style: c.styleIdx, color: c.colorIdx, why: 'Your car is locked once the race starts' }))
      return
    }
    const style = clampStyle(m.style)
    const color = clampColor(m.color)
    if (style !== c.styleIdx || color !== c.colorIdx) {
      console.log('[car]', c.name, CAR_STYLES[style].id + '->' + CAR_COLORS[color])
      c.styleIdx = style
      c.colorIdx = color
    }
    ws.send(JSON.stringify({ t: 'car', ok: true, style: c.styleIdx, color: c.colorIdx }))
  } else if (m.t === 'leave') {
    if (!c.inRace || state.phase !== 'lobby') return
    dropFromRoster(c)
    ws.send(JSON.stringify({ t: 'left' }))
  } else if (m.t === 'vote') {
    if (state.phase !== 'lobby') {
      ws.send(JSON.stringify({ t: 'voted', ok: false, why: 'Map voting is only open in the lobby' }))
      return
    }
    if (state.voteClosed) {
      ws.send(JSON.stringify({ t: 'voted', ok: false, why: 'Voting has closed — racing ' + track.name }))
      return
    }
    const idx = trackIndexOf(m.map)
    if (idx < 0 || idx >= tracks.length) {
      ws.send(JSON.stringify({ t: 'voted', ok: false, why: 'Unknown map' }))
      return
    }
    state.votes.set(c.id, idx) // a second vote replaces the first
    ws.send(JSON.stringify({ t: 'voted', ok: true, map: idx }))
  } else if (m.t === 'st' && c.inRace && Array.isArray(m.q)) {
    const q = m.q
    c.car.x = +q[0] || 0
    c.car.z = +q[1] || 0
    c.car.a = +q[2] || 0
    c.car.spd = Math.max(0, +q[5] || 0)
    c.car.flags = (+q[6] | 0) & 31
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
}

function handleClose (c) {
  clients.delete(c.id)
  state.votes.delete(c.id)
  if (c.inRace) dropFromRoster(c)
}

wss.on('connection', async ws => {
  let id, colorIdx
  let view = null // follower: the leader's phase/track for `init`
  if (coord) {
    try {
      const a = await coord.admit()
      id = a.id
      colorIdx = a.colorRaw % CAR_COLORS.length
      if (!coord.leader) view = a.meta || { ph: 'lobby', phaseEnds: null, track: track.name }
    } catch (e) {
      console.error('[coord] admit failed:', e.message)
      ws.close(1013, 'try again')
      return
    }
    if (ws.readyState !== 1) return
  } else {
    id = nextId++
    colorIdx = nextColor++ % CAR_COLORS.length
  }
  const name = NAMES[(id - 1) % NAMES.length] + '-' + String(100 + Math.floor(Math.random() * 900))
  const c = makeClient(ws, id, name, colorIdx, true, INSTANCE_ID, 0)
  clients.set(id, c)

  const ph = view ? view.ph : state.phase
  const ends = view ? view.phaseEnds : state.phaseEnds
  const init = {
    t: 'init',
    id,
    name: c.name,
    color: CAR_COLORS[c.colorIdx],
    colorIdx: c.colorIdx,
    styleIdx: c.styleIdx,
    nameMax: NAME_MAX,
    laps: TOTAL_LAPS,
    maxPlayers: MAX_PLAYERS,
    mapName: view ? view.track : track.name,
    maps: tracks.map(t => t.name),
    lobbySec: LOBBY_SEC,
    graceSec: GRACE_SEC,
    ph,
    tl: ends === null ? -1 : Math.max(0, (ends - Date.now()) / 1000),
    shared: !!coord,
    inst: INSTANCE_ID,
    leader: !coord || coord.leader
  }
  if (!view) voteFields(init)
  else if (view.ph === 'lobby') {
    // Follower: the leader's tally as of the last meta write; snaps refresh it.
    init.votes = new Array(tracks.length).fill(0)
    for (const [, idx] of view.votes || []) if (init.votes[idx] !== undefined) init.votes[idx]++
    init.voteOpen = !view.voteClosed
    init.mapIdx = tracks.findIndex(t => t.name === view.track)
  }
  ws.send(JSON.stringify(init))
  if (coord && !coord.leader) coord.forward(c, { t: 'hello' })

  ws.on('message', raw => {
    let m
    try {
      m = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!m || typeof m !== 'object') return
    if (coord && !coord.leader) coord.forward(c, m)
    else handleMessage(c, m)
  })

  ws.on('close', () => {
    if (coord && !coord.leader) {
      clients.delete(id)
      coord.forward(c, { t: 'close' })
    } else {
      handleClose(c)
    }
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
    if (roster.length === 0) {
      state.phaseEnds = null
      state.voteClosed = false // the countdown restarts, so does the vote
    }
  }
}

// ---------- shared lobby (REDIS_URL) ----------

function metaSnapshot () {
  return {
    ph: state.phase,
    phaseEnds: state.phaseEnds,
    raceStart: state.raceStart,
    graceStart: state.graceStart,
    results: state.results,
    track: track.name,
    votes: [...state.votes],
    voteClosed: state.voteClosed,
    roster: roster.map(id => clients.get(id)).filter(Boolean)
      .map(c => ({ id: c.id, name: c.name, colorIdx: c.colorIdx, styleIdx: c.styleIdx, slot: c.slot, moved: c.moved, car: c.car }))
  }
}

// Remote clients whose instance went silent, or restored racers nobody
// re-announced after a failover, leave the same way a closed socket does.
function sweepRemote (now) {
  if (state.votePruneAt && now >= state.votePruneAt) {
    // Restored votes from clients that never re-announced after a failover.
    state.votePruneAt = 0
    for (const id of [...state.votes.keys()]) if (!clients.has(id)) state.votes.delete(id)
  }
  for (const c of [...clients.values()]) {
    if (c.local) continue
    const gone = c.inst === null ? now - c.seen > RECONCILE_MS : coord.peerStale(c.inst, now)
    if (gone) {
      console.log('[coord] dropping unreachable client', c.name, c.inst === null ? '(never re-announced)' : '(instance ' + c.inst + ' silent)')
      handleClose(c)
    }
  }
}

function becomeLeader (meta) {
  for (const c of [...clients.values()]) if (!c.local) clients.delete(c.id)
  roster = []
  lastWho = ''
  for (const c of clients.values()) {
    c.inRace = false
    c.slot = -1
  }
  state.phase = 'lobby'
  state.phaseEnds = null
  state.raceStart = 0
  state.graceStart = null
  state.results = null
  state.votes.clear()
  state.voteClosed = false
  state.votePruneAt = 0
  if (!meta) return
  state.phase = meta.ph
  state.phaseEnds = meta.phaseEnds
  state.raceStart = meta.raceStart
  state.graceStart = meta.graceStart
  state.results = meta.results
  for (const [id, idx] of meta.votes || []) {
    if (Number.isInteger(idx) && idx >= 0 && idx < tracks.length) state.votes.set(id, idx)
  }
  state.voteClosed = !!meta.voteClosed
  state.votePruneAt = Date.now() + RECONCILE_MS
  const ti = tracks.findIndex(t => t.name === meta.track)
  if (ti !== -1) {
    trackPtr = trackOrder.indexOf(ti)
    track = tracks[ti]
  }
  for (const r of meta.roster) {
    let c = clients.get(r.id)
    if (!c) {
      c = makeClient(remoteWs(r.id), r.id, r.name, clampColor(r.colorIdx), false, null, clampStyle(r.styleIdx))
      clients.set(r.id, c)
    }
    c.name = r.name
    if (r.colorIdx !== undefined) c.colorIdx = clampColor(r.colorIdx)
    c.styleIdx = clampStyle(r.styleIdx)
    c.inRace = true
    c.slot = r.slot
    c.moved = r.moved
    Object.assign(c.car, r.car)
    roster.push(r.id)
  }
}

function stopLeading () {
  for (const c of [...clients.values()]) if (!c.local) clients.delete(c.id)
  roster = []
}

function onCmd ({ inst, id, name, colorIdx, styleIdx, m }) {
  let c = clients.get(id)
  if (!c) {
    if (m.t === 'close') return
    const nm = cleanName(name)
    c = makeClient(remoteWs(id), id, nm && !nameProblem(nm) ? nm : 'Racer-' + id, clampColor(colorIdx), false, inst, clampStyle(styleIdx))
    clients.set(id, c)
  }
  if (!c.local) {
    c.inst = inst
    c.seen = Date.now()
  }
  if (m.t === 'hello') return
  if (m.t === 'close') {
    if (!c.local) handleClose(c)
    return
  }
  handleMessage(c, m)
}

function onRelay (str) {
  for (const c of clients.values()) {
    if (c.local && c.ws.readyState === 1) c.ws.send(str)
  }
}

function onReply (to, str) {
  const c = clients.get(to)
  if (!c || !c.local) return
  if (c.ws.readyState === 1) c.ws.send(str)
  // Keep the follower's copy of the name and car current so a re-announce
  // after a leader change carries the chosen ones, not the defaults.
  try {
    const m = JSON.parse(str)
    if (m.t === 'named' && m.ok) c.name = m.name
    else if (m.t === 'car' && m.ok) {
      c.styleIdx = clampStyle(m.style)
      c.colorIdx = clampColor(m.color)
    }
  } catch {}
}

const coord = REDIS_URL
  ? new Coordinator({
    url: REDIS_URL,
    instanceId: INSTANCE_ID,
    handlers: {
      onPromote: becomeLeader,
      onDemote: stopLeading,
      onLeaderChange: () => coord.announce([...clients.values()].filter(c => c.local)),
      onCmd,
      onRelay,
      onReply
    }
  })
  : null

if (coord) {
  console.log(`[coord] shared world: ON (REDIS_URL via ${REDIS_VAR}, instance ${INSTANCE_ID})`)
  await coord.start()
} else {
  console.log('[coord] shared world: OFF — no REDIS_URL; this process runs its own lobby')
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    console.error([
      '',
      '!!! WARNING: running on Vercel WITHOUT a shared Redis !!!',
      '!!! Every instance of this function runs its own lobby, so players WILL',
      '!!! land in different races. Add a Redis and expose its URL as REDIS_URL',
      '!!! (or ' + REDIS_VARS.slice(1).join(' / ') + ') and redeploy.',
      '!!! See README.md, "One race for everyone".',
      ''
    ].join('\n'))
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
  const local = [...clients.values()].filter(c => c.local)
  for (const c of local) {
    if (c.ws.readyState === 1) c.ws.close(1001, 'server shutting down')
  }
  wss.close()
  const finish = () => server.close(() => process.exit(0))
  if (coord) coord.stop(local).then(finish, finish)
  else finish()
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
