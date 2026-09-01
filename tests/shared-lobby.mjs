// Shared-lobby test: two server instances behind one Redis present ONE race,
// and the survivor takes over when the leader dies.
// Run with: npm run test:shared   (needs Docker; starts redis:7-alpine on :6399)
import { spawn, execSync } from 'node:child_process'
import WebSocket from 'ws'
import Redis from 'ioredis'
import { TOTAL_LAPS } from '../shared/track.js'
import { CAR_COLORS } from '../shared/cars.js'

const REDIS_PORT = 6399
const REDIS_URL = 'redis://127.0.0.1:' + REDIS_PORT
const CONTAINER = 'racing-test-redis'
const PORTS = { s1: 8801, s2: 8802 }
const TIMERS = { LOBBY_SEC: 2, COUNTDOWN_SEC: 1, RESULTS_SEC: 2, GRACE_SEC: 3, HARD_CAP_SEC: 4, VOTE_CLOSE_SEC: 1 }
let failures = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))

function assert (cond, msg) {
  if (cond) console.log('PASS ' + msg)
  else {
    failures++
    console.log('FAIL ' + msg)
  }
}

function sh (cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts }).toString().trim()
}

// ---------- Redis via Docker ----------
let running = ''
try {
  running = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`)
} catch {}
if (running === 'true') {
  console.log('[redis] reusing running container ' + CONTAINER)
} else {
  if (running === 'false') sh(`docker rm -f ${CONTAINER}`)
  console.log('[redis] starting ' + CONTAINER)
  sh(`docker run -d --rm -p ${REDIS_PORT}:6379 --name ${CONTAINER} redis:7-alpine`)
}
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => 200 })
redis.on('error', () => {})
let up = false
for (let i = 0; i < 100 && !up; i++) {
  try {
    if (redis.status !== 'ready') await redis.connect().catch(() => {})
    up = (await redis.ping()) === 'PONG'
  } catch {
    await sleep(200)
  }
}
if (!up) {
  console.log('FAIL redis did not answer on ' + REDIS_URL)
  process.exit(1)
}
await redis.flushdb()
console.log('[redis] ready')

// ---------- two servers ----------
const servers = {}
const logs = { s1: [], s2: [] }
function startServer (inst) {
  const p = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, ...TIMERS, PORT: PORTS[inst], REDIS_URL, INSTANCE_ID: inst },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const onData = d => {
    for (const line of d.toString().split('\n')) {
      if (!line) continue
      logs[inst].push(line)
      process.stdout.write(`[${inst}] ${line}\n`)
    }
  }
  p.stdout.on('data', onData)
  p.stderr.on('data', onData)
  servers[inst] = p
  return p
}
startServer('s1')
await sleep(400)
startServer('s2')
await sleep(1200)

function cleanup () {
  for (const p of Object.values(servers)) {
    try { p.kill('SIGKILL') } catch {}
  }
  try { redis.disconnect() } catch {}
  try { sh(`docker stop ${CONTAINER}`) } catch {}
}
process.on('exit', cleanup)

function mkClient (label, port) {
  const c = { label, port, ws: new WebSocket('ws://localhost:' + port), snaps: [], joins: [], inits: [], maps: [], named: [], cars: [], voted: [], closed: false }
  c.ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    if (m.t === 'init') c.inits.push(m)
    else if (m.t === 'named') c.named.push(m)
    else if (m.t === 'car') c.cars.push(m)
    else if (m.t === 'voted') c.voted.push(m)
    else if (m.t === 'map') c.maps.push(m.name)
    else if (m.t === 'joined') c.joins.push(m)
    else if (m.t === 'snap') c.snaps.push(m)
  })
  c.ws.on('close', () => { c.closed = true })
  c.ws.on('error', () => {})
  return new Promise((resolve, reject) => {
    c.ws.on('open', () => resolve(c))
    c.ws.on('error', reject)
  })
}

function waitFor (pred, timeout, desc) {
  return new Promise(resolve => {
    const start = Date.now()
    const iv = setInterval(() => {
      let ok = false
      try { ok = pred() } catch {}
      if (ok) {
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
const idOf = c => c.inits[0].id
const send = (c, obj) => c.ws.send(JSON.stringify(obj))
const drive = (c, lap, prog, spd = 30, x = 10, z = 10) => send(c, { t: 'st', q: [x, z, 0, lap, prog, spd, 0] })
const carOf = (c, who) => last(c) && last(c).cars.find(x => x.id === idOf(who))

// ---------- one lobby across both instances ----------
const leader0 = await redis.get('race:leader')
assert(leader0 === 's1' || leader0 === 's2', 'a leader was elected: ' + leader0)
const follower0 = leader0 === 's1' ? 's2' : 's1'

const A = await mkClient('A', PORTS.s1)
const B = await mkClient('B', PORTS.s2)
assert(await waitFor(() => A.inits.length && B.inits.length, 3000, 'init'), 'both clients received init')
assert(idOf(A) !== idOf(B), 'ids are unique across instances: ' + idOf(A) + ' / ' + idOf(B))
assert(A.inits[0].mapName === B.inits[0].mapName, 'both instances announce the same map: ' + A.inits[0].mapName)
assert(await waitFor(() => last(A) && last(B) && last(A).ph === 'lobby' && last(B).ph === 'lobby', 3000, 'lobby snaps'), 'both clients get lobby snapshots')

send(B, { t: 'name', name: 'Relayed' })
assert(await waitFor(() => B.named.length === 1, 2000, 'B named'), 'rename over the relay answered')
assert(B.named[0] && B.named[0].ok && B.named[0].name === 'Relayed', 'relayed rename applied')
send(B, { t: 'car', style: 3, color: 9 })
assert(await waitFor(() => B.cars.length === 1, 2000, 'B car'), 'car pick over the relay answered')
assert(B.cars[0] && B.cars[0].ok && B.cars[0].style === 3 && B.cars[0].color === 9, 'relayed car pick applied')

// Map vote relayed across instances and mirrored into race:meta.
const mapList = A.inits[0].maps
const votedIdx = mapList.findIndex(n => n !== A.inits[0].mapName)
send(B, { t: 'vote', map: votedIdx })
assert(await waitFor(() => B.voted.length === 1, 2000, 'B voted'), 'vote over the relay answered')
assert(B.voted[0] && B.voted[0].ok && B.voted[0].map === votedIdx, 'relayed vote accepted for ' + mapList[votedIdx])
assert(await waitFor(() => last(A).votes && last(A).votes[votedIdx] === 1 && last(B).votes && last(B).votes[votedIdx] === 1, 1500, 'tally on both'), 'both instances show the vote in their snapshots')
assert(await waitFor(async () => {
  const meta = JSON.parse(await redis.get('race:meta') || '{}')
  return Array.isArray(meta.votes) && meta.votes.some(([id, idx]) => id === idOf(B) && idx === votedIdx)
}, 2500, 'meta votes'), 'race:meta carries the vote for failover')

send(A, { t: 'join' })
assert(await waitFor(() => A.joins.length === 1 && A.joins[0].ok, 2000, 'A joined'), 'A join accepted on :' + PORTS.s1)
assert(await waitFor(() => carOf(B, A), 1000, 'B sees A'), 'B (on :' + PORTS.s2 + ') sees A on the grid within 1 s')
send(B, { t: 'join' })
assert(await waitFor(() => B.joins.length === 1 && B.joins[0].ok, 2000, 'B joined'), 'B join accepted on :' + PORTS.s2)
assert(await waitFor(() => last(A).cars.length === 2 && last(B).cars.length === 2, 1000, 'both cars'), 'both snapshots list both cars')
{
  const sa = last(A).cars.map(c => c.si).sort()
  const sb = last(B).cars.map(c => c.si).sort()
  assert(sa.join() === '0,1' && sb.join() === '0,1', 'cars have distinct slots on both: ' + sa + ' / ' + sb)
  assert(carOf(A, B) && carOf(A, B).n === 'Relayed', 'A sees B under the relayed name')
  assert(carOf(A, B) && carOf(A, B).sty === 3 && carOf(A, B).col === CAR_COLORS[9], 'A sees B in the relayed car style and colour')
}

assert(await waitFor(() => last(A).ph === 'racing' && last(B).ph === 'racing', 6000, 'racing'), 'race starts on both')
assert(A.maps.at(-1) === mapList[votedIdx] && B.maps.at(-1) === mapList[votedIdx], 'the voted map is raced on both instances: ' + A.maps.at(-1))
const C = await mkClient('C', PORTS[follower0])
await waitFor(() => C.inits.length, 2000, 'C init')
assert(C.inits[0] && C.inits[0].ph === 'racing', 'late arrival on the follower is told the race is on (init.ph=' + (C.inits[0] && C.inits[0].ph) + ')')
send(C, { t: 'join' })
assert(await waitFor(() => C.joins.length === 1, 2000, 'C join reply'), 'late join answered')
assert(C.joins[0] && C.joins[0].ok === false && /Race in progress/.test(C.joins[0].why), 'late arrival during racing is refused: ' + (C.joins[0] && C.joins[0].why))
assert(await waitFor(() => last(C) && last(C).ph === 'racing' && last(C).cars.length === 2, 2000, 'C snaps'), 'spectator on the follower receives race snapshots')

drive(B, 0, 0.3, 30, 33, 44)
assert(await waitFor(() => carOf(A, B) && carOf(A, B).x === 33 && carOf(A, B).z === 44, 1000, 'B state on A'), 'driving state sent on :' + PORTS.s2 + ' shows in snapshots on :' + PORTS.s1)

drive(A, 0, 0.5)
await sleep(120)
drive(A, 1, 0.5)
await sleep(120)
drive(A, TOTAL_LAPS, 0.0)
assert(await waitFor(() => last(A).gl >= 0 && last(B).gl >= 0, 2000, 'grace'), 'grace window starts on both')
assert(await waitFor(() => last(A).ph === 'finished' && last(B).ph === 'finished', 6000, 'finished'), 'race finishes on both')
assert(JSON.stringify(last(A).res) === JSON.stringify(last(B).res), 'identical results on both instances')
assert(last(A).res && last(A).res[0].id === idOf(A) && last(A).res[1].id === idOf(B) && last(A).res[1].time === 0, 'winner and DNF ranked as expected')
assert(await waitFor(() => last(A).ph === 'lobby' && last(B).ph === 'lobby', 5000, 'lobby again'), 'lobby reopens on both')
await sleep(150)
assert(A.maps.length >= 2 && B.maps.length >= 2 && A.maps.at(-1) === B.maps.at(-1) && A.maps.at(-1) !== mapList[votedIdx], 'map rotated identically on both: ' + A.maps.at(-1))
assert(last(A).cars.length === 2 && last(B).cars.length === 2, 'both racers kept on the grid on both instances')
C.ws.close()

// ---------- leader failover ----------
const leader = await redis.get('race:leader')
const survivor = leader === 's1' ? 's2' : 's1'
const victim = leader === 's1' ? A : B
const S = leader === 's1' ? B : A
assert(logs[leader].some(l => l.startsWith('[leader] ' + leader)), 'leader ' + leader + ' logged its election')
console.log('[test] killing leader ' + leader + ' (SIGKILL); survivor ' + survivor)
const n0 = S.snaps.length
const tKill = Date.now()
servers[leader].kill('SIGKILL')
assert(await waitFor(() => S.snaps.length > n0 + 5, 6000, 'snapshots resume'), 'survivor keeps sending snapshots after failover (' + ((Date.now() - tKill) / 1000).toFixed(1) + 's)')
assert(await waitFor(() => logs[survivor].some(l => l.startsWith('[leader] ' + survivor)), 2000, 'survivor election log'), 'survivor ' + survivor + ' took the lease')
assert(await waitFor(() => victim.closed, 2000, 'victim closed'), 'client on the dead instance lost its socket')
assert(await waitFor(() => last(S).cars.length === 1 && last(S).cars[0].id === idOf(S), 5000, 'ghost dropped'), 'racer from the dead instance is dropped from the grid')
assert(carOf(S, S) && carOf(S, S).sty === (S === B ? 3 : 0), 'surviving racer keeps its car style across the failover')
assert(await waitFor(() => last(S).ph === 'racing', 8000, 'race after failover'), 'phase keeps advancing: race starts after failover')
assert(await waitFor(() => last(S).ph === 'finished', 8000, 'finish after failover'), 'race finishes after failover')
assert(await waitFor(() => last(S).ph === 'lobby', 5000, 'lobby after failover'), 'lobby reopens after failover')
const D = await mkClient('D', PORTS[survivor])
await waitFor(() => D.inits.length, 2000, 'D init')
assert(D.inits[0] && D.inits[0].ph === 'lobby', 'new client on the survivor sees the lobby')
send(D, { t: 'join' })
assert(await waitFor(() => D.joins.length === 1 && D.joins[0].ok, 2000, 'D joined'), 'new client can join the lobby on the survivor')
assert(await waitFor(() => last(S).cars.some(c => c.id === idOf(D)), 1000, 'D on grid'), 'survivor snapshots show the new racer')

A.ws.close()
B.ws.close()
D.ws.close()
console.log(failures === 0 ? 'SHARED LOBBY TEST PASSED' : 'SHARED LOBBY TEST FAILED (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
