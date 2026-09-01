// Server smoke test: lobby -> countdown -> racing -> grace timeout -> results -> lobby.
// Run with: node tests/smoke.mjs   (spawns its own server on port 8799 with short timers)
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import { tracks, TOTAL_LAPS } from '../shared/track.js'

const PORT = 8799
const URL = 'ws://localhost:' + PORT
let failures = 0
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT, LOBBY_SEC: 2, COUNTDOWN_SEC: 1, RESULTS_SEC: 2, GRACE_SEC: 3, HARD_CAP_SEC: 4 },
  stdio: ['ignore', 'pipe', 'inherit']
})
server.stdout.on('data', d => process.stdout.write('[server] ' + d))
const sleep = ms => new Promise(r => setTimeout(r, ms))
await sleep(600)

function assert (cond, msg) {
  if (cond) console.log('PASS ' + msg)
  else {
    failures++
    console.log('FAIL ' + msg)
  }
}

function mkClient (label) {
  const c = { label, ws: new WebSocket(URL), snaps: [], joins: [], inits: [], maps: [], named: [] }
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.t === 'init') c.inits.push(m)
    else if (m.t === 'named') c.named.push(m)
    else if (m.t === 'map') c.maps.push(m.name)
    else if (m.t === 'joined') c.joins.push(m)
    else if (m.t === 'snap') c.snaps.push(m)
  })
  return new Promise((resolve, reject) => {
    c.ws.on('open', () => resolve(c))
    c.ws.on('error', reject)
  })
}

function waitFor (pred, timeout, desc) {
  return new Promise(resolve => {
    const start = Date.now()
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv)
        resolve(true)
      } else if (Date.now() - start > timeout) {
        clearInterval(iv)
        console.log('TIMEOUT waiting for ' + desc)
        resolve(false)
      }
    }, 40)
  })
}
const last = c => c.snaps[c.snaps.length - 1]
const send = (c, obj) => c.ws.send(JSON.stringify(obj))
const drive = (c, lap, prog, spd = 30) => send(c, { t: 'st', q: [10, 10, 0, lap, prog, spd, 0] })

const A = await mkClient('A')
const B = await mkClient('B')
assert(await waitFor(() => A.inits.length && B.inits.length, 3000, 'init'), 'both clients received init')
assert(A.inits[0].laps === TOTAL_LAPS && TOTAL_LAPS === 2, 'race is 2 laps')
assert(A.inits[0].maxPlayers === 14, 'lobby allows 14 players')
assert(tracks.some(t => t.name === A.inits[0].mapName), 'init names a known map')
await waitFor(() => last(A) && last(A).ph === 'lobby', 2000, 'lobby snap')
assert(last(A).tl === -1, 'lobby waits (no countdown) until someone joins')

// Naming: free in the lobby, sanitised, and frozen once the grid locks.
const carOf = (c, who) => last(c).cars.find(x => x.id === who.inits[0].id)
send(A, { t: 'name', name: '  <b>Speedy</b>   McGee-the-Fastest ' })
assert(await waitFor(() => A.named.length === 1, 2000, 'A named'), 'rename answered')
assert(A.named[0].ok && A.named[0].name === 'bSpeedy/b McGe', 'name is stripped of markup, whitespace-collapsed and capped at 14 chars: ' + JSON.stringify(A.named[0].name))
send(A, { t: 'name', name: 'Speedy' })
await waitFor(() => A.named.length === 2, 2000, 'A renamed')
send(A, { t: 'name', name: '   ' })
assert(await waitFor(() => A.named.length === 3, 2000, 'blank name'), 'blank name answered')
assert(A.named[2].ok === false && A.named[2].name === 'Speedy', 'blank name rejected, previous name kept')

send(A, { t: 'join' })
assert(await waitFor(() => A.joins.length === 1 && A.joins[0].ok, 2000, 'A joined'), 'A join accepted, slot ' + (A.joins[0] && A.joins[0].slot))
await sleep(120)
assert(carOf(A, A) && carOf(A, A).n === 'Speedy', 'snapshot carries the chosen name')
send(A, { t: 'name', name: 'StillLobby' })
assert(await waitFor(() => A.named.length === 4 && A.named[3].ok, 2000, 'lobby rename'), 'a racer can still rename while the lobby is open')
await sleep(150)
assert(last(A).tl > 0 && last(A).tl <= 2, 'countdown started on first join')
send(B, { t: 'join' })
assert(await waitFor(() => B.joins.length === 1 && B.joins[0].ok, 2000, 'B joined'), 'B join accepted')

assert(await waitFor(() => last(A).ph === 'countdown' && last(A).cars.length === 2, 5000, 'countdown'), 'countdown phase with a locked grid of 2')
send(B, { t: 'join' })
await sleep(100)
assert(B.joins.length === 2 && B.joins[1].ok === false, 'joining during countdown is rejected')
assert(await waitFor(() => last(A).ph === 'racing', 4000, 'racing'), 'racing phase begins')
send(A, { t: 'name', name: 'TooLate' })
assert(await waitFor(() => A.named.length === 5, 2000, 'locked rename'), 'rename during the race answered')
assert(A.named[4].ok === false && A.named[4].name === 'StillLobby' && carOf(A, A).n === 'StillLobby', 'name is locked once the race starts')
const S = await mkClient('S')
await waitFor(() => S.inits.length, 2000, 'spectator init')
send(S, { t: 'name', name: 'Watcher' })
assert(await waitFor(() => S.named.length === 1, 2000, 'spectator rename'), 'spectator rename answered')
assert(S.named[0].ok && S.named[0].name === 'Watcher', 'a spectator can rename while a race is running')
S.ws.close()

// A drives and finishes both laps; B moves a little but never finishes.
drive(A, 0, 0.5)
drive(B, 0, 0.2)
await sleep(120)
drive(A, 1, 0.5)
await sleep(120)
const t0 = Date.now()
drive(A, TOTAL_LAPS, 0.0)
assert(await waitFor(() => last(A).gl >= 0 && last(A).gl <= 3, 2000, 'grace countdown'), 'grace countdown starts once the leader finishes')
assert(last(A).cars.find(c => c.id === A.inits[0].id).fin === 1, 'leader flagged finished')
assert(await waitFor(() => last(A).ph === 'finished', 6000, 'finished'), 'race ends when the grace timer runs out (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)')
const res = last(A).res
assert(res && res.length === 2 && res[0].id === A.inits[0].id && res[0].time > 0, 'winner ranked first with a time')
assert(res[1].id === B.inits[0].id && res[1].time === 0, 'unfinished racer listed as DNF')

const firstMap = A.inits[0].mapName
assert(await waitFor(() => last(A).ph === 'lobby', 5000, 'lobby again'), 'lobby reopens after results')
await sleep(100)
assert(A.maps.length >= 1 && A.maps[A.maps.length - 1] !== firstMap, 'map rotated: ' + firstMap + ' -> ' + A.maps[A.maps.length - 1])
const ids = last(A).cars.map(c => c.id)
assert(ids.includes(A.inits[0].id) && ids.includes(B.inits[0].id), 'racers who drove are kept on the grid for the next race')
assert(last(A).cars.every(c => c.l === 0 && c.fin === 0), 'cars reset to lap 0 on the grid')

// Leaving the grid
send(B, { t: 'leave' })
await sleep(150)
assert(!last(A).cars.some(c => c.id === B.inits[0].id), 'leave removes a racer from the grid')

// Idle racers are dropped after the race
assert(await waitFor(() => last(A).ph === 'racing', 6000, 'second race'), 'second race starts')
assert(await waitFor(() => last(A).ph === 'finished', 8000, 'second race end'), 'second race ends at the hard cap when nobody finishes')
assert(await waitFor(() => last(A).ph === 'lobby', 5000, 'third lobby'), 'lobby reopens again')
await sleep(100)
assert(last(A).cars.length === 0 && last(A).tl === -1, 'idle racer dropped from the grid; lobby waits for a new join')

A.ws.close()
B.ws.close()
server.kill()
console.log(failures === 0 ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
