// Shared-lobby coordination over Redis, used by server.js when REDIS_URL is set.
//
// Every server instance that shares a Redis presents ONE lobby/race to its
// clients. One instance is the LEADER: it runs the authoritative state machine
// in server.js exactly as it does in single-process mode. Every other instance
// is a FOLLOWER: it accepts WebSockets, hands out globally unique ids, and
// relays messages both ways over three pub/sub channels:
//
//   race:cmd    follower -> leader   {inst, b: [{id, name, colorIdx, styleIdx, m}, ...]} where m
//                                     is a client message or a synthetic {t:'hello'} / {t:'close'};
//                                     name/colorIdx/styleIdx are the follower's copy of the
//                                     client's customisation, used when the leader first hears
//                                     of the client (later changes arrive as {t:'name'}/{t:'car'});
//                                     a follower batches everything it hears into one
//                                     publish per FLUSH_MS. Plus {inst, t:'ping'} presence beats.
//   race:reply  leader -> follower   {to: id, msg: <raw JSON string>}  (joined/named/car/left)
//   race:bcast  leader -> followers  <raw JSON string> (snap/map), relayed verbatim
//
// Keys:
//   race:leader     lease: instanceId, PX LEASE_MS, refreshed by the leader
//   race:meta       JSON of the leader's state (phase, timers, track, results, roster
//                   with car state), rewritten on change and at least every META_MS,
//                   PX META_TTL_MS so a dead cluster starts fresh
//   race:nextid, race:nextcolor   INCR counters for client ids / colours
//
// Guarantees (and non-guarantees):
//  - At most one leader at a time: the lease is only ever refreshed or the meta
//    written by a Lua compare-and-refresh that checks ownership, and a leader that
//    has not confirmed its lease for LEASE_MS demotes itself.
//  - Failover: when the lease expires (leader died) or is released (SIGTERM), a
//    follower wins it within POLL_MS and restores phase, timers, track and roster
//    (including car state, at most META_MS old) from race:meta. Racers on the dead
//    instance are dropped once nothing has been heard from them for RECONCILE_MS;
//    every other instance re-announces its clients as soon as it sees a new leader.
//  - A client message published while no leader holds the lease is lost (the
//    client simply sees no reply; the next click/tick resends). Nothing is queued.
//  - Redis being unreachable freezes the race (no leader) rather than splitting
//    it: instances never fall back to running their own lobby.
import Redis from 'ioredis'

export const LEASE_MS = 3000        // leader lease
const LEASE_REFRESH_MS = 500        // how often the leader refreshes it
const POLL_MS = 500                 // follower: try to acquire + ping
const FLUSH_MS = 50                 // follower: batch client messages into one publish
const META_MS = 1000                // leader: unconditional meta write cadence
const META_TTL_MS = 15000
export const PEER_TTL_MS = 4000     // follower considered dead when silent this long
export const RECONCILE_MS = 2500    // new leader: time for restored racers to re-announce

const K = { leader: 'race:leader', meta: 'race:meta', nextId: 'race:nextid', nextColor: 'race:nextcolor' }
const CH = { cmd: 'race:cmd', reply: 'race:reply', bcast: 'race:bcast' }

// Refresh the lease and (optionally) write meta, but only if we still own it.
const LUA_TICK = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
if ARGV[3] ~= '' then redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4]) end
return 1`
// Compare-and-delete on shutdown so a follower can take over immediately.
const LUA_RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`

function waitReady (r, ms) {
  return new Promise(resolve => {
    if (r.status === 'ready') return resolve(true)
    const t = setTimeout(() => resolve(false), ms)
    r.once('ready', () => {
      clearTimeout(t)
      resolve(true)
    })
  })
}

function slowKey (meta) {
  // The part of meta that changes rarely; a change forces an immediate write.
  return JSON.stringify([meta.ph, meta.phaseEnds, meta.raceStart, meta.graceStart, meta.track, meta.results,
    meta.roster.map(r => [r.id, r.name, r.slot, r.moved, r.car.fin, r.car.finT])])
}

export class Coordinator {
  // handlers: onPromote(meta|null), onDemote(), onLeaderChange(instanceId),
  //           onCmd(cmd), onRelay(str), onReply(id, str)
  constructor ({ url, instanceId, handlers }) {
    this.inst = instanceId
    this.h = handlers
    this.leader = false
    this.knownLeader = null
    this.peers = new Map() // instanceId -> last time we heard from it (leader only)
    this.pendingBcast = []
    this.outbox = [] // follower: client messages waiting for the next flush
    this.flushTimer = null
    this.lastLeaseAt = 0
    this.lastLeaseOk = 0
    this.lastMetaAt = 0
    this.lastMetaSlow = ''
    this.polling = false
    this.pollTimer = null
    this.stopped = false
    const opts = { enableOfflineQueue: false, maxRetriesPerRequest: 1 }
    this.redis = new Redis(url, opts)
    this.sub = new Redis(url) // subscriptions are replayed by ioredis on reconnect
    this.redis.defineCommand('leaseTick', { numberOfKeys: 2, lua: LUA_TICK })
    this.redis.defineCommand('leaseRelease', { numberOfKeys: 1, lua: LUA_RELEASE })
    for (const [label, r] of [['cmd', this.redis], ['sub', this.sub]]) {
      r.on('error', e => console.error('[coord]', label, 'redis error:', e.message))
      r.on('ready', () => console.log('[coord]', label, 'redis connected'))
    }
    this.sub.on('message', (ch, str) => this.onMessage(ch, str))
  }

  async start () {
    const ok = await Promise.all([waitReady(this.redis, 3000), waitReady(this.sub, 3000)])
    if (!ok.every(Boolean)) {
      console.error('[coord] REDIS_URL is set but Redis did not answer within 3 s; retrying in the background. Until it connects this instance has no lobby.')
    }
    this.sub.subscribe(CH.cmd, CH.reply, CH.bcast).catch(e => console.error('[coord] subscribe failed:', e.message))
    await this.poll() // a cold cluster gets a leader before the first client
    this.pollTimer = setInterval(() => this.poll(), POLL_MS)
    console.log('[coord] instance', this.inst, this.leader ? 'is leader' : 'is follower of ' + this.knownLeader)
  }

  // Allocate a cluster-unique id/colour and fetch the leader's view for `init`.
  async admit () {
    const res = await this.redis.pipeline().incr(K.nextId).incr(K.nextColor).get(K.meta).exec()
    for (const [err] of res) if (err) throw err
    let meta = null
    try {
      meta = res[2][1] ? JSON.parse(res[2][1]) : null
    } catch {}
    return { id: res[0][1], colorRaw: res[1][1] - 1, meta }
  }

  // The leader's last written state (phase, timers, track, roster), or null.
  // Used for /health on a follower, which holds no race state of its own.
  async readMeta () {
    if (this.redis.status !== 'ready') return null
    try {
      const raw = await this.redis.get(K.meta)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  // ----- follower side -----
  forward (c, m) {
    this.outbox.push({ id: c.id, name: c.name, colorIdx: c.colorIdx, styleIdx: c.styleIdx, m })
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS)
  }

  announce (localClients) {
    for (const c of localClients) this.forward(c, { t: 'hello' })
  }

  flush () {
    this.flushTimer = null
    const b = this.outbox
    this.outbox = []
    if (!b.length || this.redis.status !== 'ready') return null
    return this.redis.publish(CH.cmd, JSON.stringify({ inst: this.inst, b })).catch(() => {})
  }

  async poll () {
    if (this.leader || this.polling || this.stopped || this.redis.status !== 'ready') return
    this.polling = true
    try {
      const res = await this.redis.pipeline()
        .set(K.leader, this.inst, 'PX', LEASE_MS, 'NX')
        .get(K.leader)
        .publish(CH.cmd, JSON.stringify({ inst: this.inst, t: 'ping' }))
        .exec()
      const won = !res[0][0] && res[0][1] === 'OK'
      const cur = res[1][0] ? null : res[1][1]
      if (won) {
        await this.promote()
      } else if (cur !== this.knownLeader) {
        this.knownLeader = cur
        if (cur) this.h.onLeaderChange(cur)
      }
    } catch (e) {
      console.error('[coord] poll failed:', e.message)
    } finally {
      this.polling = false
    }
  }

  async promote () {
    const issuedAt = Date.now()
    let meta = null
    try {
      const raw = await this.redis.get(K.meta)
      meta = raw ? JSON.parse(raw) : null
    } catch (e) {
      console.error('[coord] meta read failed on promote:', e.message)
    }
    if (this.stopped) return
    this.leader = true
    this.knownLeader = this.inst
    this.lastLeaseAt = issuedAt
    this.lastLeaseOk = issuedAt
    this.lastMetaAt = 0
    this.lastMetaSlow = ''
    this.peers.clear()
    this.pendingBcast = []
    console.log('[leader]', this.inst, meta ? `restored ${meta.ph} on ${meta.track}, roster ${meta.roster.length}` : 'fresh state')
    this.h.onPromote(meta)
  }

  demote (why) {
    if (!this.leader) return
    this.leader = false
    this.knownLeader = null
    this.pendingBcast = []
    console.error('[coord]', this.inst, 'demoted:', why)
    this.h.onDemote()
  }

  // ----- leader side -----
  queueBcast (str) {
    if (this.leader) this.pendingBcast.push(str)
  }

  reply (id, str) {
    if (this.redis.status !== 'ready') return
    this.redis.publish(CH.reply, JSON.stringify({ to: id, msg: str })).catch(() => {})
  }

  peersActive (now) {
    for (const t of this.peers.values()) if (now - t <= PEER_TTL_MS) return true
    return false
  }

  peerStale (inst, now) {
    const t = this.peers.get(inst)
    return t === undefined || now - t > PEER_TTL_MS
  }

  // Called by the leader at the end of every tick. One pipeline holding, as
  // needed: the lease refresh (every LEASE_REFRESH_MS, carrying meta when it
  // changed or META_MS passed) and the queued broadcasts (only while some
  // follower is alive; a lone leader publishes nothing).
  afterTick (meta) {
    if (!this.leader) return
    const now = Date.now()
    if (now - this.lastLeaseOk > LEASE_MS) return this.demote('lease not confirmed for ' + LEASE_MS + ' ms')
    const bcast = this.pendingBcast
    this.pendingBcast = []
    if (this.redis.status !== 'ready') return
    const slow = slowKey(meta)
    const writeMeta = slow !== this.lastMetaSlow || now - this.lastMetaAt >= META_MS
    const refresh = writeMeta || now - this.lastLeaseAt >= LEASE_REFRESH_MS
    const p = this.redis.pipeline()
    let n = 0
    if (refresh) {
      p.leaseTick(K.leader, K.meta, this.inst, LEASE_MS, writeMeta ? JSON.stringify(meta) : '', META_TTL_MS)
      n++
      this.lastLeaseAt = now
      if (writeMeta) {
        this.lastMetaAt = now
        this.lastMetaSlow = slow
      }
    }
    if (this.peersActive(now)) {
      for (const s of bcast) {
        p.publish(CH.bcast, s)
        n++
      }
    }
    if (!n) return
    p.exec().then(res => {
      if (!refresh) return
      const [err, val] = res[0]
      if (err) console.error('[coord] lease refresh failed:', err.message)
      else if (val === 1) this.lastLeaseOk = Math.max(this.lastLeaseOk, now)
      else this.demote('lease owned by someone else')
    }).catch(e => console.error('[coord] tick pipeline failed:', e.message))
  }

  onMessage (ch, str) {
    if (ch === CH.bcast) {
      if (!this.leader) this.h.onRelay(str)
      return
    }
    let m
    try {
      m = JSON.parse(str)
    } catch {
      return
    }
    if (ch === CH.reply) {
      if (typeof m.to === 'number' && typeof m.msg === 'string') this.h.onReply(m.to, m.msg)
      return
    }
    if (!this.leader) return
    if (typeof m.inst === 'string' && m.inst !== this.inst) this.peers.set(m.inst, Date.now())
    if (m.t === 'ping' || !Array.isArray(m.b)) return
    for (const e of m.b) {
      if (e && typeof e.id === 'number' && e.m && typeof e.m === 'object') this.h.onCmd({ inst: m.inst, id: e.id, name: e.name, colorIdx: e.colorIdx, styleIdx: e.styleIdx, m: e.m })
    }
  }

  // Leader: release the lease so a follower takes over now. Follower: tell the
  // leader our clients are gone instead of letting them time out.
  async stop (localClients) {
    this.stopped = true
    clearInterval(this.pollTimer)
    try {
      if (this.leader) {
        this.leader = false
        await this.redis.leaseRelease(K.leader, this.inst)
      } else {
        for (const c of localClients) this.forward(c, { t: 'close' })
        clearTimeout(this.flushTimer)
        await this.flush()
      }
    } catch (e) {
      console.error('[coord] stop:', e.message)
    }
    await Promise.allSettled([this.redis.quit(), this.sub.quit()])
  }
}
