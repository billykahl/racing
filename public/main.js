import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { trackByName, tracks, HALF_W, SHOULDER, WALL_DIST, TOTAL_LAPS, MAX_PLAYERS } from '/shared/track.js'
import { CAR_STYLES, CAR_COLORS, clampStyle, clampColor } from '/shared/cars.js'
import { World } from './world.js'
import { Car } from './car.js'
import { GameAudio } from './audio.js'
import { softDotTexture } from './textures.js'

// ---------- DOM ----------
const $ = id => document.getElementById(id)
const elStand = $('standings')
const elInfo = $('raceInfo')
const elPhase = $('phaseMsg')
const elSub = $('subMsg')
const elBig = $('bigCount')
const elNotice = $('notice')
const elJoinWrap = $('joinWrap')
const elBtn = $('joinBtn')
const elJoinMsg = $('joinMsg')
const elMapVote = $('mapVote')
const elMapGrid = $('mapVoteGrid')
const elMapStatus = $('mapVoteStatus')
const elName = $('nameInput')
const elStyleRow = $('styleRow')
const elColorRow = $('colorRow')
const elResults = $('results')
const elOverlay = $('overlay')
const elOverlayMsg = $('overlayMsg')
const elSpeedo = $('speedo')
const elSpeedVal = $('speedVal')
const elGaugeArc = $('gaugeArc')
const elBoost = $('boostBar')
const elMini = $('minimap')
const elQuality = $('quality')
const elMute = $('muteBtn')
const elLeave = $('leaveBtn')
const elFps = $('fps')

// ---------- quality ----------
const QUALITY = {
  ultra: { dpr: 2, shadow: 4096, ao: true, bloom: true, trees: 1100, farTrees: 1700, grass: 7000, shadowRange: 90 },
  high: { dpr: 1.5, shadow: 2048, ao: false, bloom: true, trees: 800, farTrees: 1100, grass: 3500, shadowRange: 80 },
  medium: { dpr: 1, shadow: 1024, ao: false, bloom: false, trees: 450, farTrees: 600, grass: 1200, shadowRange: 70 }
}
let qualityName = localStorage.getItem('race.quality') || 'ultra'
if (!QUALITY[qualityName]) qualityName = 'ultra'
elQuality.value = qualityName
let Q = QUALITY[qualityName]

// ---------- renderer / scene ----------
const canvas = $('gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.72
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 5000)
camera.position.set(0, 60, 120)

const sun = new THREE.DirectionalLight(0xfff1dc, 2.1)
sun.castShadow = true
sun.shadow.bias = -0.0003
sun.shadow.normalBias = 0.03
sun.shadow.camera.near = 20
sun.shadow.camera.far = 900
scene.add(sun)
scene.add(sun.target)
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x54683a, 0.35)
scene.add(hemi)

function applyShadowQuality () {
  sun.shadow.mapSize.set(Q.shadow, Q.shadow)
  const r = Q.shadowRange
  sun.shadow.camera.left = -r
  sun.shadow.camera.right = r
  sun.shadow.camera.top = r
  sun.shadow.camera.bottom = -r
  sun.shadow.camera.updateProjectionMatrix()
  if (sun.shadow.map) {
    sun.shadow.map.dispose()
    sun.shadow.map = null
  }
}
applyShadowQuality()

let composer = null
let aoPass = null
let bloomPass = null
function setupPost () {
  if (composer) {
    composer.dispose()
    composer = null
  }
  aoPass = null
  bloomPass = null
  if (!Q.bloom && !Q.ao) return
  const w = renderer.domElement.width
  const h = renderer.domElement.height
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 })
  composer = new EffectComposer(renderer, rt)
  composer.addPass(new RenderPass(scene, camera))
  if (Q.ao) {
    aoPass = new GTAOPass(scene, camera, w, h)
    aoPass.output = GTAOPass.OUTPUT.Default
    aoPass.blendIntensity = 0.85
    aoPass.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1, thickness: 1, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
    // The AO pre-pass would draw sprites / alpha-tested quads as solid rectangles.
    const origHide = aoPass._overrideVisibility.bind(aoPass)
    aoPass._overrideVisibility = () => {
      origHide()
      scene.traverse(o => {
        if ((o.isSprite || o.userData.noAO) && o.visible) {
          o.visible = false
          aoPass._visibilityCache.push(o)
        }
      })
    }
    composer.addPass(aoPass)
  }
  if (Q.bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.4, 3.0)
    composer.addPass(bloomPass)
  }
  composer.addPass(new OutputPass())
}

function resize () {
  const dpr = Math.min(window.devicePixelRatio || 1, Q.dpr)
  renderer.setPixelRatio(dpr)
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  if (composer) {
    composer.setPixelRatio(dpr)
    composer.setSize(innerWidth, innerHeight)
  }
}
addEventListener('resize', resize)
resize()
setupPost()

// ---------- game state ----------
let me = null
let phase = 'boot'
let tl = -1
let gl = -1
let clock = 0
let res = null
let carsSnap = []
let sorted = []
let standingsDirty = true
let mapName = ''
let track = null
let world = null
let LAPS = TOTAL_LAPS
let lobbySec = 30
let graceSec = 30
let own = null
let ownCar = null
let joined = false
let pending = false
const remote = new Map()
let ws = null
let connected = false
let lastPhase = 'boot'
let lastCount = -1
let goPending = false
let cameraMode = 0
const audio = new GameAudio()
const clockT = new THREE.Timer()
let simTime = 0

// ---------- particles ----------
class Particles {
  constructor (max) {
    this.max = max
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.vel = new Float32Array(max * 3)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.grow = new Float32Array(max)
    this.baseAlpha = new Float32Array(max)
    this.head = 0
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDotTexture() } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (600.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true,
      depthWrite: false
    })
    this.points = new THREE.Points(g, mat)
    this.points.frustumCulled = false
    this.geo = g
  }

  spawn (x, y, z, vx, vy, vz, life, size, r, g, b, alpha = 0.6, grow = 1.5) {
    const i = this.head
    this.head = (this.head + 1) % this.max
    this.pos.set([x, y, z], i * 3)
    this.vel.set([vx, vy, vz], i * 3)
    this.col.set([r, g, b], i * 3)
    this.life[i] = life
    this.maxLife[i] = life
    this.size[i] = size
    this.alpha[i] = alpha
    this.grow[i] = grow
    this.baseAlpha[i] = alpha
  }

  update (dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        continue
      }
      this.life[i] -= dt
      const f = Math.max(0, this.life[i] / this.maxLife[i])
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      this.vel[i * 3] *= 0.96
      this.vel[i * 3 + 2] *= 0.96
      this.alpha[i] = this.baseAlpha[i] * f
      this.size[i] += this.grow[i] * dt
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.alpha.needsUpdate = true
    this.geo.attributes.size.needsUpdate = true
    this.geo.attributes.color.needsUpdate = true
  }
}
const smoke = new Particles(900)
scene.add(smoke.points)
const sparks = new Particles(400)
sparks.points.material.blending = THREE.AdditiveBlending
scene.add(sparks.points)

// ---------- skid marks ----------
class SkidMarks {
  constructor (maxQuads) {
    this.max = maxQuads
    this.pos = new Float32Array(maxQuads * 4 * 3)
    this.birth = new Float32Array(maxQuads * 4)
    const idx = new Uint32Array(maxQuads * 6)
    for (let i = 0; i < maxQuads; i++) {
      const b = i * 4
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('birth', new THREE.BufferAttribute(this.birth, 1))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    this.uTime = { value: 0 }
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: `attribute float birth; varying float vB; void main(){ vB = birth; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying float vB; void main(){ if (vB < 0.0) discard; float a = 0.55 * clamp(1.0 - (uTime - vB) / 40.0, 0.0, 1.0); gl_FragColor = vec4(0.05,0.05,0.06,a); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.head = 0
    this.birth.fill(-1)
    this.geo = g
  }

  add (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, time) {
    const i = this.head
    this.head = (this.head + 1) % this.max
    this.pos.set([ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz], i * 12)
    this.birth.fill(time, i * 4, i * 4 + 4)
    this.dirty = true
  }

  flush () {
    if (!this.dirty) return
    this.dirty = false
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.birth.needsUpdate = true
  }

  clear () {
    this.birth.fill(-1)
    this.geo.attributes.birth.needsUpdate = true
  }
}
const skids = new SkidMarks(6000)
scene.add(skids.mesh)

// ---------- networking ----------
function connect () {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host)
  ws.onopen = () => { connected = true }
  ws.onclose = () => {
    connected = false
    joined = false
    pending = false
    carSent = null
    dropOwn()
    for (const r of remote.values()) removeRemote(r)
    remote.clear()
    carsSnap = []
    standingsDirty = true
    myVote = -1
    voteOpen = false
    renderVote()
    elOverlayMsg.textContent = 'Connection lost — reconnecting…'
    elOverlay.style.display = 'flex'
    setTimeout(connect, 1200)
  }
  ws.onmessage = e => {
    let m
    try {
      m = JSON.parse(e.data)
    } catch {
      return
    }
    handle(m)
  }
}

// Player names are user-typed: escape them before they hit innerHTML.
function esc (str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

let nameMax = 14
let nameSent = ''
function sendName () {
  if (!connected || ws.readyState !== 1 || !me) return
  const want = elName.value.trim().slice(0, nameMax)
  if (!want) {
    elName.value = me.name
    return
  }
  if (want === me.name || want === nameSent) return
  nameSent = want
  ws.send(JSON.stringify({ t: 'name', name: want }))
}

// ---------- car picker ----------
// `pick` is what the panel highlights (the player's latest click); `me.style` / `me.colorIdx` are what the
// server has confirmed. The two diverge only while a `car` request is in flight or after a refused change.
let pick = { style: 0, color: 0 }
let carSent = null
const styleBtns = CAR_STYLES.map((st, i) => {
  const b = document.createElement('button')
  b.className = 'styleBtn'
  b.type = 'button'
  b.textContent = st.label
  b.addEventListener('click', () => {
    choosePick(i, pick.color)
    b.blur()
  })
  elStyleRow.appendChild(b)
  return b
})
const swatchBtns = CAR_COLORS.map((hex, i) => {
  const b = document.createElement('button')
  b.className = 'swatch'
  b.type = 'button'
  b.style.background = hex
  b.title = hex
  b.setAttribute('aria-label', 'Colour ' + (i + 1))
  b.addEventListener('click', () => {
    choosePick(pick.style, i)
    b.blur()
  })
  elColorRow.appendChild(b)
  return b
})

function setPickUI () {
  styleBtns.forEach((b, i) => b.classList.toggle('sel', i === pick.style))
  swatchBtns.forEach((b, i) => b.classList.toggle('sel', i === pick.color))
}

function setPickerLocked (locked) {
  for (const b of styleBtns) b.disabled = locked
  for (const b of swatchBtns) b.disabled = locked
}

function loadSavedCar () {
  try {
    const v = JSON.parse(localStorage.getItem('race.car') || 'null')
    if (v && typeof v === 'object') return { style: clampStyle(v.style), color: clampColor(v.color) }
  } catch {
    return null
  }
  return null
}

function choosePick (style, color) {
  pick = { style: clampStyle(style), color: clampColor(color) }
  setPickUI()
  localStorage.setItem('race.car', JSON.stringify(pick))
  sendCar()
}

function sendCar () {
  if (!connected || ws.readyState !== 1 || !me) return
  if (pick.style === me.style && pick.color === me.colorIdx) return
  if (carSent && carSent.style === pick.style && carSent.color === pick.color) return
  carSent = { style: pick.style, color: pick.color }
  ws.send(JSON.stringify({ t: 'car', style: pick.style, color: pick.color }))
}

// Replace a Car model in place: same pose, same parent, old one disposed.
function swapCar (old, colorHex, name, isSelf, style) {
  const car = new Car(colorHex, name, isSelf, style)
  car.group.position.copy(old.group.position)
  car.group.quaternion.copy(old.group.quaternion)
  const parent = old.group.parent
  if (parent) {
    parent.remove(old.group)
    parent.add(car.group)
  }
  old.dispose()
  return car
}

function applyOwnCar (style, color) {
  const hex = CAR_COLORS[color]
  if (me.style === style && me.colorIdx === color && me.color === hex) return
  me.style = style
  me.colorIdx = color
  me.color = hex
  if (ownCar) ownCar = swapCar(ownCar, me.color, me.name, true, me.style)
}

function handle (m) {
  if (m.t === 'init') {
    const styleIdx = clampStyle(m.styleIdx !== undefined ? m.styleIdx : 0)
    let colorIdx = m.colorIdx !== undefined ? clampColor(m.colorIdx) : CAR_COLORS.indexOf(String(m.color || '').toLowerCase())
    if (colorIdx < 0) colorIdx = 0
    me = { id: m.id, name: m.name, color: m.color || CAR_COLORS[colorIdx], style: styleIdx, colorIdx }
    nameMax = m.nameMax || 14
    elName.maxLength = nameMax
    // Reuse the name from last time; the server still gets the final say.
    const saved = (localStorage.getItem('race.name') || '').slice(0, nameMax)
    elName.value = saved || m.name
    if (saved && saved !== m.name) ws.send(JSON.stringify({ t: 'name', name: saved }))
    // Same for the car: highlight the saved pick and ask the server for it if it differs from what we got.
    pick = loadSavedCar() || { style: me.style, color: me.colorIdx }
    setPickUI()
    carSent = null
    sendCar()
    LAPS = m.laps
    lobbySec = m.lobbySec
    graceSec = m.graceSec
    phase = m.ph
    tl = m.tl
    myVote = -1
    buildVoteTiles(m.maps || [])
    applyVoteSnap(m)
    loadTrack(m.mapName)
  } else if (m.t === 'map') {
    loadTrack(m.name)
  } else if (m.t === 'voted') {
    if (m.ok) {
      myVote = m.map
      renderVote()
    } else {
      elJoinMsg.textContent = m.why || 'Vote not counted'
      setTimeout(() => { elJoinMsg.textContent = '' }, 4000)
    }
  } else if (m.t === 'joined') {
    if (m.ok) {
      pending = true
    } else {
      elJoinMsg.textContent = m.why
      setTimeout(() => { elJoinMsg.textContent = '' }, 4000)
    }
  } else if (m.t === 'named') {
    nameSent = ''
    if (me) me.name = m.name
    if (m.ok) {
      localStorage.setItem('race.name', m.name)
      if (document.activeElement !== elName) elName.value = m.name
      elName.classList.remove('bad')
    } else {
      elName.value = m.name
      elName.classList.add('bad')
      elJoinMsg.textContent = m.why || 'Name not changed'
      setTimeout(() => {
        elName.classList.remove('bad')
        elJoinMsg.textContent = ''
      }, 3000)
    }
  } else if (m.t === 'car') {
    carSent = null
    const style = clampStyle(m.style)
    const color = clampColor(m.color)
    // Whether accepted or refused, the reply carries the values now in effect.
    pick = { style, color }
    setPickUI()
    if (me) applyOwnCar(style, color)
    if (m.ok) {
      localStorage.setItem('race.car', JSON.stringify(pick))
    } else {
      elJoinMsg.textContent = m.why || 'Car not changed'
      setTimeout(() => { elJoinMsg.textContent = '' }, 3000)
    }
  } else if (m.t === 'left') {
    dropOwn()
    joined = false
    pending = false
  } else if (m.t === 'snap') {
    phase = m.ph
    tl = m.tl
    gl = m.gl
    clock = m.clock
    res = m.res
    const seen = new Set()
    const now = performance.now()
    for (const c of m.cars) {
      seen.add(c.id)
      if (me && c.id === me.id) {
        me.name = c.n
        if (own) own.slot = c.si
        if (!own && (pending || phase !== 'racing')) {
          // (re)spawn on our grid slot
          spawnOwn(c.si)
          joined = true
          pending = false
        } else if (own && phase === 'lobby' && lastPhase === 'finished') {
          respawnOwn(c.si)
        }
        continue
      }
      let r = remote.get(c.id)
      const sty = clampStyle(c.sty)
      if (!r) {
        r = { id: c.id, buf: [], x: c.x, z: c.z, a: c.a, col: c.col, sty, n: c.n, car: null, idx: -1, spd: 0, flags: 0, l: 0, p: 0, quat: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), lastSkid: null }
        r.car = new Car(c.col, c.n, false, sty)
        if (world) scene.add(r.car.group)
        remote.set(c.id, r)
      } else if (r.col !== c.col || r.sty !== sty) {
        // A rival re-picked their car in the lobby: rebuild it where it stands. The label / place badge is
        // refreshed by rebuildStandings on the next HUD tick (standingsDirty is set below).
        r.col = c.col
        r.sty = sty
        r.car = swapCar(r.car, c.col, c.n, false, sty)
      }
      r.n = c.n
      r.spd = c.s
      r.flags = c.f
      r.l = c.l
      r.p = c.p
      r.buf.push({ t: now, x: c.x, z: c.z, a: c.a })
      if (r.buf.length > 10) r.buf.shift()
    }
    for (const id of [...remote.keys()]) {
      if (!seen.has(id)) {
        removeRemote(remote.get(id))
        remote.delete(id)
      }
    }
    carsSnap = m.cars
    standingsDirty = true
    if (lastPhase !== 'countdown' && phase === 'countdown') lastCount = -1
    if (lastPhase === 'countdown' && phase === 'racing') goPending = true
    if (phase === 'lobby' || phase === 'finished') elBig.className = ''
    if (me && joined && !seen.has(me.id)) {
      // Server dropped us (idle in the last race or lobby reset)
      dropOwn()
      joined = false
    }
    if (phase === 'lobby' && lastPhase === 'finished') {
      skids.clear()
      if (own) {
        own.lap = 0
        own.fin = false
        own.cpHalf = false
      }
    }
    if (phase === 'lobby' && lastPhase !== 'lobby') myVote = -1
    applyVoteSnap(m)
    lastPhase = phase
  }
}

function removeRemote (r) {
  if (r.car) {
    scene.remove(r.car.group)
    r.car.dispose()
  }
}

function dropOwn () {
  if (ownCar) {
    scene.remove(ownCar.group)
    ownCar.dispose()
    ownCar = null
  }
  own = null
}

function spawnOwn (slot) {
  dropOwn()
  const g = track.gridPose(slot)
  const n = track.nearest(g.x, g.z, -1)
  own = {
    x: g.x, z: g.z, y: g.y, a: g.a, vx: 0, vz: 0, idx: n.idx, lap: 0, prog: n.prog, prevProg: n.prog, cpHalf: false, fin: false,
    steer: 0, boost: 1, boostOn: false, boostCd: 0, drifting: false, driftDir: 0, driftT: 0, driftRamp: 0, turbo: 0, slipVis: 0, fwd: 0, lat: 0, off: false, shoulder: false,
    normal: new THREE.Vector3(0, 1, 0), quat: new THREE.Quaternion(), hitCool: 0, lastSkidL: null, lastSkidR: null, moved: false, slot
  }
  ownCar = new Car(me.color, me.name, true, me.style)
  scene.add(ownCar.group)
  placeCar(ownCar, own.x, own.y, own.z, own.a, own.quat)
  boostPress = false
  camReset = true
}

function respawnOwn (slot) {
  const g = track.gridPose(slot)
  const n = track.nearest(g.x, g.z, -1)
  Object.assign(own, { x: g.x, z: g.z, y: g.y, a: g.a, vx: 0, vz: 0, idx: n.idx, lap: 0, prog: n.prog, prevProg: n.prog, cpHalf: false, fin: false, boost: 1, boostOn: false, boostCd: 0, drifting: false, driftDir: 0, driftT: 0, driftRamp: 0, turbo: 0, fwd: 0, lat: 0 })
  boostPress = false
  camReset = true
}

// ---------- lobby map vote ----------
let mapNames = []
let voteTally = []
let voteOpen = false
let voteMapIdx = -1
let myVote = -1
let voteKey = ''
const voteTiles = [] // { btn, count, name }

// Small north-up thumbnail of the centreline, drawn once per map.
function drawThumb (cv, tr) {
  const dpr = 2
  const W = 104 * dpr
  const H = 64 * dpr
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  g.fillStyle = 'rgba(30, 40, 30, 0.9)'
  g.fillRect(0, 0, W, H)
  const pad = 8 * dpr
  const s = Math.min((W - pad * 2) / (tr.maxX - tr.minX), (H - pad * 2) / (tr.maxZ - tr.minZ))
  const ox = (W - (tr.maxX - tr.minX) * s) / 2
  const oz = (H - (tr.maxZ - tr.minZ) * s) / 2
  const X = p => ox + (p.x - tr.minX) * s
  const Z = p => oz + (p.z - tr.minZ) * s
  g.lineCap = g.lineJoin = 'round'
  const path = () => {
    g.beginPath()
    tr.pts.forEach((p, i) => (i === 0 ? g.moveTo(X(p), Z(p)) : g.lineTo(X(p), Z(p))))
    g.closePath()
  }
  path()
  g.lineWidth = 7 * dpr
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.stroke()
  path()
  g.lineWidth = 4.5 * dpr
  g.strokeStyle = '#9aa0a8'
  g.stroke()
  const p0 = tr.pts[0]
  g.strokeStyle = '#fff'
  g.lineWidth = 2 * dpr
  g.beginPath()
  g.moveTo(X(p0) - p0.tz * 4 * dpr, Z(p0) + p0.tx * 4 * dpr)
  g.lineTo(X(p0) + p0.tz * 4 * dpr, Z(p0) - p0.tx * 4 * dpr)
  g.stroke()
}

function buildVoteTiles (names) {
  if (names.join('\u0000') === mapNames.join('\u0000') && voteTiles.length) return
  mapNames = names
  voteTiles.length = 0
  elMapGrid.innerHTML = ''
  names.forEach((name, idx) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mapTile'
    btn.title = 'Vote for ' + name
    const cv = document.createElement('canvas')
    const tr = trackByName(name) || tracks[idx]
    if (tr) drawThumb(cv, tr)
    const nm = document.createElement('span')
    nm.className = 'mapName'
    nm.textContent = name
    const cnt = document.createElement('span')
    cnt.className = 'mapCount'
    btn.append(cv, nm, cnt)
    btn.addEventListener('click', () => {
      audio.resume()
      if (!connected || ws.readyState !== 1 || phase !== 'lobby' || !voteOpen || myVote === idx) return
      ws.send(JSON.stringify({ t: 'vote', map: idx }))
    })
    elMapGrid.appendChild(btn)
    voteTiles.push({ btn, count: cnt, name })
  })
  voteKey = ''
  renderVote()
}

function applyVoteSnap (m) {
  if (Array.isArray(m.votes)) {
    voteTally = m.votes
    voteOpen = !!m.voteOpen
    voteMapIdx = typeof m.mapIdx === 'number' ? m.mapIdx : -1
  } else if (phase !== 'lobby') {
    voteOpen = false
  }
  renderVote()
}

// Only touches the DOM when something visible changed.
function renderVote () {
  if (!voteTiles.length) return
  const key = voteTally.join(',') + '|' + (voteOpen ? 1 : 0) + '|' + voteMapIdx + '|' + myVote + '|' + (connected ? 1 : 0)
  if (key === voteKey) return
  voteKey = key
  const max = Math.max(0, ...voteTally)
  voteTiles.forEach((t, i) => {
    const n = voteTally[i] || 0
    const txt = n ? String(n) : ''
    if (t.count.textContent !== txt) t.count.textContent = txt
    t.btn.disabled = !voteOpen || !connected
    t.btn.classList.toggle('lead', voteOpen && n > 0 && n === max)
    t.btn.classList.toggle('mine', myVote === i)
    t.btn.classList.toggle('win', !voteOpen && i === voteMapIdx)
  })
  const winName = mapNames[voteMapIdx] || mapName
  elMapStatus.textContent = voteOpen
    ? (myVote >= 0 ? 'Your vote: ' + mapNames[myVote] + ' — click another map to change it' : 'Most votes wins • ties are a coin flip')
    : 'Voting closed — racing ' + winName
}

// ---------- track / world ----------
let loadingWorld = false
function loadTrack (name) {
  mapName = name
  track = trackByName(name)
  elOverlayMsg.textContent = 'Building ' + name + '…'
  elOverlay.style.display = 'flex'
  loadingWorld = true
  setTimeout(() => {
    if (world) {
      world.dispose()
      world = null
    }
    world = new World(track, Q, renderer, scene)
    sun.position.copy(world.sunDir).multiplyScalar(400)
    for (const r of remote.values()) {
      if (!r.car.group.parent) scene.add(r.car.group)
      r.idx = -1
    }
    if (own && phase !== 'racing') respawnOwn(own.slot)
    skids.clear()
    buildMinimap()
    elOverlay.style.display = 'none'
    loadingWorld = false
    camReset = true
    fpsWindow.length = 0
  }, 40)
}

// ---------- input ----------
const keys = {}
// Set on a fresh press of the boost key (not key-repeat, not held), consumed by step().
let boostPress = false
const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'left', KeyD: 'right',
  KeyW: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost', ArrowUp: 'boost',
  KeyS: 'brake', ArrowDown: 'brake',
  Space: 'drift'
}
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return
  const k = KEYMAP[e.code]
  if (!k) {
    if (e.code === 'KeyR') rescue()
    if (e.code === 'KeyC') cameraMode = (cameraMode + 1) % 3
    if (e.code === 'KeyM') toggleMute()
    return
  }
  if (e.target && e.target.tagName === 'BUTTON') e.target.blur()
  e.preventDefault()
  if (k === 'boost' && !keys.boost && !e.repeat) boostPress = true
  keys[k] = true
  audio.resume()
})
addEventListener('keyup', e => {
  const k = KEYMAP[e.code]
  if (k) keys[k] = false
})
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false
  boostPress = false
})

function rescue () {
  if (!own || phase !== 'racing' || own.fin) return
  const p = track.poseAt(own.prog * track.len)
  own.x = p.x
  own.z = p.z
  own.a = p.a
  own.vx = own.vz = 0
  own.fwd = own.lat = 0
  own.drifting = false
  own.driftRamp = 0
}

function toggleMute () {
  audio.ensure()
  audio.setMuted(!audio.muted)
  elMute.textContent = audio.muted ? '🔇' : '🔊'
}
elMute.textContent = audio.muted ? '🔇' : '🔊'
elMute.addEventListener('click', toggleMute)

elQuality.addEventListener('change', () => {
  qualityName = elQuality.value
  localStorage.setItem('race.quality', qualityName)
  applyQuality()
  elQuality.blur()
})

function applyQuality () {
  Q = QUALITY[qualityName]
  applyShadowQuality()
  resize()
  setupPost()
  if (mapName) loadTrack(mapName)
}

elBtn.addEventListener('click', () => {
  audio.resume()
  if (!connected || joined || phase !== 'lobby' || ws.readyState !== 1) return
  elBtn.disabled = true
  ws.send(JSON.stringify({ t: 'join' }))
})
elName.addEventListener('keydown', e => {
  e.stopPropagation()
  if (e.code === 'Enter' || e.code === 'NumpadEnter') elName.blur()
  if (e.code === 'Escape') {
    elName.value = me ? me.name : ''
    elName.blur()
  }
})
elName.addEventListener('change', sendName)
elName.addEventListener('blur', sendName)
elLeave.addEventListener('click', () => {
  if (!connected || !joined || phase !== 'lobby') return
  ws.send(JSON.stringify({ t: 'leave' }))
  elLeave.blur()
})

// ---------- physics ----------
const P = { top: 46, boostTop: 63, accel: 21, brake: 34, reverse: 8, offTop: 21 }
const tmpN = new THREE.Vector3()
const tmpF = new THREE.Vector3()
const tmpR = new THREE.Vector3()
const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
let sendAcc = 0
let camReset = false

function step (dt) {
  if (!own || !world) return
  const racing = phase === 'racing' && !own.fin
  const st = (keys.left ? -1 : 0) + (keys.right ? 1 : 0)
  own.steer += (st - own.steer) * Math.min(1, dt * 10)
  const brake = racing && !!keys.brake
  const driftKey = racing && !!keys.drift
  const throttle = racing && !brake ? 1 : 0

  const hx = Math.cos(own.a)
  const hz = Math.sin(own.a)
  const px = -hz
  const pz = hx
  let fwd = own.vx * hx + own.vz * hz
  let lat = own.vx * px + own.vz * pz

  const n = track.nearest(own.x, own.z, own.idx)
  const onTrack = n.dist < HALF_W
  const onShoulder = n.dist < HALF_W + SHOULDER
  const off = !onShoulder
  own.off = off
  own.shoulder = onShoulder && !onTrack

  // Boost meter.
  // A boost is latched on by a fresh press (edge, not hold) when the meter is at/above 50% and no cooldown is
  // running. Once latched it keeps going while the key is held, even below 50%, until the key is released, the
  // meter empties, or racing stops. Any end starts a 1s cooldown during which presses are discarded.
  own.boostCd = Math.max(0, own.boostCd - dt)
  const press = boostPress
  boostPress = false
  if (own.boostOn && (!racing || !keys.boost || own.boost <= 0.02)) {
    own.boostOn = false
    own.boostCd = 1.0
  }
  if (!own.boostOn && press && racing && keys.boost && own.boostCd <= 0 && own.boost >= 0.5) own.boostOn = true
  const wantBoost = own.boostOn && fwd > 2
  if (wantBoost) own.boost = Math.max(0, own.boost - dt * 0.36)
  else if (!own.boostOn) own.boost = Math.min(1, own.boost + dt * (own.drifting && own.driftDir !== 0 ? 0.18 : 0.055))
  own.boosting = wantBoost
  own.turbo = Math.max(0, own.turbo - dt)
  const turbo = own.turbo > 0

  let top = P.top
  let acc = P.accel
  if (wantBoost) {
    top = P.boostTop
    acc += 24
  }
  if (turbo) {
    top += 9
    acc += 16
  }
  if (off) top = Math.min(top, P.offTop)
  else if (own.shoulder) top *= 0.92

  if (throttle) {
    if (fwd < top) fwd += acc * (1 - Math.max(0, fwd) / top * 0.55) * dt
  }
  if (brake) {
    if (fwd > 0.5) fwd -= P.brake * dt
    else fwd = Math.max(fwd - 10 * dt, -P.reverse)
  }
  if (!racing) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 22 * dt)

  let dragK = 0.1 + (off ? 1.5 : 0) + (own.shoulder ? 0.35 : 0)
  if (fwd > top) dragK += 1.0
  fwd *= Math.exp(-dragK * dt)
  fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 1.2 * dt)

  // Slope: climbing slows, descending speeds up
  const slopeUp = -(own.normal.x * hx + own.normal.z * hz)
  fwd -= 9.81 * slopeUp * 0.55 * dt

  // Drift
  // Space alone starts the drift: the rear goes loose (low grip, tail wag) with no extra turn yet. The first
  // steer press while drifting locks the direction, and only then does the sharper drift turn ramp in over
  // ~0.15s so the sequence reads "rear steps out, then the kart rotates". Mini-turbo time (driftT) and the
  // faster boost regen only accrue while the drift is directional, so holding Space straight is no free reward.
  if (driftKey && !own.drifting && Math.abs(fwd) > 11) {
    own.drifting = true
    own.driftDir = st
    own.driftT = 0
    own.driftRamp = 0
  }
  if (own.drifting && own.driftDir === 0 && st !== 0) own.driftDir = st
  if (own.drifting && (!driftKey || fwd < 5 || !racing)) {
    if (own.driftT > 0.9 && racing) {
      own.turbo = own.driftT > 2.2 ? 1.6 : 1.0
      audio.miniTurbo()
      burstSparks(own, 30, 0.4, 0.7, 1.0)
    }
    own.drifting = false
    own.driftRamp = 0
  }
  let grip = 7.5
  let om
  const speedF = 1 / (1 + Math.max(0, fwd) / 70)
  if (own.drifting) {
    grip = 1.7
    if (own.driftDir !== 0) {
      own.driftT += dt
      own.driftRamp = Math.min(1, own.driftRamp + dt / 0.15)
      om = own.driftDir * 1.9 * speedF * own.driftRamp + own.steer * 0.9 * speedF
      fwd *= Math.exp(-0.16 * dt)
      lat += -own.driftDir * 5 * dt
      if (own.driftT > 0.9 && Math.floor(simTime * 30) % 2 === 0) burstSparks(own, 2, own.driftT > 2.2 ? 1.0 : 0.3, own.driftT > 2.2 ? 0.5 : 0.7, own.driftT > 2.2 ? 0.1 : 1.0)
    } else {
      // Neutral drift: no steer input, just a subtle loose-rear wobble that doesn't change the line.
      om = own.steer * 0.9 * speedF
      lat += Math.sin(simTime * 9) * 1.2 * dt
    }
  } else {
    om = own.steer * 2.8 * Math.min(1, Math.abs(fwd) / 9) * speedF * (fwd < 0 ? -1 : 1)
  }
  if (off) grip = Math.min(grip, 3.2)
  lat *= Math.exp(-grip * dt)
  own.a += om * dt
  const hx2 = Math.cos(own.a)
  const hz2 = Math.sin(own.a)
  own.vx = hx2 * fwd + -hz2 * lat
  own.vz = hz2 * fwd + hx2 * lat
  own.x += own.vx * dt
  own.z += own.vz * dt
  own.fwd = fwd
  own.lat = lat
  if (Math.abs(fwd) > 1) own.moved = true

  carCollide()
  wallClamp(dt)

  const nx = track.nearest(own.x, own.z, own.idx)
  own.idx = nx.idx
  own.prog = nx.prog
  own.nearest = nx
  lapLogic(nx.prog)

  // Height & orientation
  own.y = world.carHeight(own.x, own.z, nx)
  world.groundNormal(own.x, own.z, nx, tmpN)
  own.normal.lerp(tmpN, Math.min(1, dt * 10)).normalize()

  // Skid marks + smoke
  const slip = own.drifting || Math.abs(lat) > 5 || (brake && fwd > 15)
  own.slipVis += ((own.drifting ? (own.driftDir !== 0 ? own.driftDir * 0.28 : Math.sin(simTime * 7) * 0.14) : 0) - own.slipVis) * Math.min(1, dt * 6)
  if (slip && racing && onShoulder) laySkids(own, hx2, hz2)
  else own.lastSkidL = own.lastSkidR = null
  if (racing && Math.abs(fwd) > 4) {
    if (slip && onShoulder) emitSmoke(own.x, own.y, own.z, hx2, hz2, fwd, 0.85, 0.85, 0.85, 0.35)
    if (off) emitSmoke(own.x, own.y, own.z, hx2, hz2, fwd, 0.55, 0.45, 0.3, 0.5)
  }
}

function wallClamp (dt) {
  const n = track.nearest(own.x, own.z, own.idx)
  const maxD = WALL_DIST - 1.0
  own.hitCool = Math.max(0, own.hitCool - dt)
  if (n.dist <= maxD) return
  let nx = own.x - n.cx
  let nz = own.z - n.cz
  const d = Math.hypot(nx, nz) || 1
  nx /= d
  nz /= d
  own.x = n.cx + nx * maxD
  own.z = n.cz + nz * maxD
  const vn = own.vx * nx + own.vz * nz
  if (vn > 0) {
    const speed = Math.hypot(own.vx, own.vz) || 1
    const strength = vn / speed
    own.vx -= nx * vn * 1.5
    own.vz -= nz * vn * 1.5
    const keep = 1 - 0.15 - strength * 0.45
    own.vx *= keep
    own.vz *= keep
    if (own.hitCool <= 0 && vn > 3) {
      own.hitCool = 0.25
      audio.impact(Math.min(1, vn / 30))
      for (let i = 0; i < 12; i++) {
        sparks.spawn(own.x + nx * 1.2, own.y + 0.4, own.z + nz * 1.2, (Math.random() - 0.5) * 8 - nx * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 8 - nz * 4, 0.4 + Math.random() * 0.3, 0.35, 1, 0.75, 0.3, 0.9, 0)
      }
      camShake = Math.min(1, camShake + strength)
    }
  }
}

function carCollide () {
  for (const r of remote.values()) {
    const dx = own.x - r.x
    const dz = own.z - r.z
    const d2 = dx * dx + dz * dz
    if (d2 > 3.4 * 3.4 || d2 === 0) continue
    const d = Math.sqrt(d2)
    const nx = dx / d
    const nz = dz / d
    const push = (3.4 - d) * 0.5
    own.x += nx * push
    own.z += nz * push
    const vn = own.vx * nx + own.vz * nz
    if (vn < 0) {
      own.vx -= nx * vn * 0.8
      own.vz -= nz * vn * 0.8
      if (own.hitCool <= 0 && -vn > 4) {
        own.hitCool = 0.3
        audio.impact(Math.min(1, -vn / 25))
      }
    }
  }
}

function lapLogic (prog) {
  const prev = own.prevProg
  if (prev > 0.9 && prog < 0.1) {
    if (own.cpHalf) {
      own.lap++
      own.cpHalf = false
      if (own.lap >= LAPS) {
        own.fin = true
        audio.finish()
        showNotice('FINISHED!')
      } else {
        audio.lap()
        showNotice(own.lap === LAPS - 1 ? 'FINAL LAP' : 'LAP ' + (own.lap + 1))
      }
    }
  } else if (prev < 0.1 && prog > 0.9) {
    own.cpHalf = false
  }
  if (prog > 0.45 && prog < 0.55) own.cpHalf = true
  own.prevProg = prog
}

function laySkids (c, hx, hz) {
  const px = -hz
  const pz = hx
  for (const side of [-1, 1]) {
    const wx = c.x - hx * 1.35 + px * side * 0.86
    const wz = c.z - hz * 1.35 + pz * side * 0.86
    const wy = world.carHeight(wx, wz, c.nearest) + 0.03
    const key = side < 0 ? 'lastSkidL' : 'lastSkidR'
    const last = c[key]
    if (last) {
      const dx = wx - last.x
      const dz = wz - last.z
      const len = Math.hypot(dx, dz)
      if (len > 0.25) {
        const ox = -dz / len * 0.16
        const oz = dx / len * 0.16
        skids.add(last.x - ox, last.y, last.z - oz, last.x + ox, last.y, last.z + oz, wx - ox, wy, wz - oz, wx + ox, wy, wz + oz, simTime)
        c[key] = { x: wx, y: wy, z: wz }
      }
    } else {
      c[key] = { x: wx, y: wy, z: wz }
    }
  }
}

function emitSmoke (x, y, z, hx, hz, fwd, r, g, b, alpha) {
  const px = -hz
  const pz = hx
  for (const side of [-1, 1]) {
    if (Math.random() > 0.6) continue
    const wx = x - hx * 1.4 + px * side * 0.9
    const wz = z - hz * 1.4 + pz * side * 0.9
    smoke.spawn(wx, y + 0.25, wz, (Math.random() - 0.5) * 2 - hx * fwd * 0.15, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 2 - hz * fwd * 0.15, 0.7 + Math.random() * 0.6, 0.9, r, g, b, alpha, 2.2)
  }
}

function burstSparks (c, n, r, g, b) {
  const hx = Math.cos(c.a)
  const hz = Math.sin(c.a)
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1
    sparks.spawn(c.x - hx * 1.5 - hz * side * 0.9, c.y + 0.3, c.z - hz * 1.5 + hx * side * 0.9,
      -hx * (4 + Math.random() * 6) + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, -hz * (4 + Math.random() * 6) + (Math.random() - 0.5) * 4,
      0.25 + Math.random() * 0.3, 0.3, r, g, b, 0.9, 0)
  }
}

// ---------- placement helpers ----------
function placeCar (car, x, y, z, a, quat, normal, slipVis = 0) {
  car.group.position.set(x, y, z)
  if (normal) {
    tmpF.set(Math.cos(a + slipVis), 0, Math.sin(a + slipVis))
    // project forward onto the ground plane
    tmpF.addScaledVector(normal, -tmpF.dot(normal)).normalize()
    tmpR.crossVectors(tmpF, normal).normalize()
    tmpM.makeBasis(tmpF, normal, tmpR)
    tmpQ.setFromRotationMatrix(tmpM)
    quat.slerp(tmpQ, 0.5)
    car.group.quaternion.copy(quat)
  } else {
    car.group.rotation.set(0, -a, 0)
  }
}

function lerpAng (a, b, f) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * f
}

function updateRemotes (dt, now) {
  const tR = now - 130
  for (const r of remote.values()) {
    const b = r.buf
    if (!b.length) continue
    if (b.length >= 2 && b[0].t <= tR) {
      let i = b.length - 2
      while (i > 0 && b[i].t > tR) i--
      const A = b[i]
      const B = b[Math.min(i + 1, b.length - 1)]
      const span = B.t - A.t
      const f = span > 0 ? Math.max(0, Math.min(1, (tR - A.t) / span)) : 1
      r.x = A.x + (B.x - A.x) * f
      r.z = A.z + (B.z - A.z) * f
      r.a = lerpAng(A.a, B.a, f)
    } else {
      const k = 1 - Math.exp(-10 * dt)
      const t = b[b.length - 1]
      r.x += (t.x - r.x) * k
      r.z += (t.z - r.z) * k
      r.a = lerpAng(r.a, t.a, k)
    }
    if (!world || !r.car) continue
    const n = track.nearest(r.x, r.z, r.idx)
    r.idx = n.idx
    r.y = world.carHeight(r.x, r.z, n)
    world.groundNormal(r.x, r.z, n, tmpN)
    r.up.lerp(tmpN, Math.min(1, dt * 8)).normalize()
    const drifting = !!(r.flags & 1)
    const boosting = !!(r.flags & 2)
    const braking = !!(r.flags & 4)
    const neutral = drifting && !!(r.flags & 16)
    const driftDir = drifting && !neutral ? (r.flags & 8 ? -1 : 1) : 0
    r.slipVis = (r.slipVis || 0) + ((drifting ? (neutral ? Math.sin(simTime * 7) * 0.14 : driftDir * 0.28) : 0) - (r.slipVis || 0)) * Math.min(1, dt * 6)
    placeCar(r.car, r.x, r.y, r.z, r.a, r.quat, r.up, r.slipVis)
    r.car.animate(dt, r.spd, driftDir, braking, boosting, simTime, drifting ? (driftDir || 2) : 0)
    if (drifting && r.spd > 4 && phase === 'racing') {
      const hx = Math.cos(r.a)
      const hz = Math.sin(r.a)
      emitSmoke(r.x, r.y, r.z, hx, hz, r.spd, 0.85, 0.85, 0.85, 0.3)
      r.nearest = n
      if (n.dist < HALF_W + SHOULDER) laySkids(r, hx, hz)
      else r.lastSkidL = r.lastSkidR = null
    } else {
      r.lastSkidL = r.lastSkidR = null
    }
  }
}

// ---------- camera ----------
const camPos = new THREE.Vector3()
const camLook = new THREE.Vector3()
const camDesired = new THREE.Vector3()
const camLookDesired = new THREE.Vector3()
let camFov = 60
let camShake = 0

function updateCamera (dt) {
  if (!world) return
  const t = track
  let target = null
  let heading = 0
  let speed = 0
  let boosting = false
  if (own) {
    target = own
    heading = own.a
    speed = own.fwd
    boosting = own.boosting || own.turbo > 0
  } else if ((phase === 'racing' || phase === 'finished') && sorted.length) {
    const leader = remote.get(sorted[0].id)
    if (leader && leader.y !== undefined) {
      target = leader
      heading = leader.a
      speed = leader.spd
      boosting = !!(leader.flags & 2)
    }
  }
  let fovTarget = 60
  if (target) {
    let hx = Math.cos(heading)
    let hz = Math.sin(heading)
    if (own && cameraMode !== 2) {
      // blend towards the velocity direction so drifts swing the camera
      const vs = Math.hypot(own.vx, own.vz)
      if (vs > 4) {
        const vx = own.vx / vs
        const vz = own.vz / vs
        hx = hx * 0.7 + vx * 0.3
        hz = hz * 0.7 + vz * 0.3
        const l = Math.hypot(hx, hz)
        hx /= l
        hz /= l
      }
    }
    const up = target.normal || target.up || new THREE.Vector3(0, 1, 0)
    if (cameraMode === 2) {
      camDesired.set(target.x + hx * 0.6, target.y + 1.45, target.z + hz * 0.6)
      camLookDesired.set(target.x + hx * 30, target.y + 1.2, target.z + hz * 30)
      camPos.copy(camDesired)
      camLook.copy(camLookDesired)
      fovTarget = 70
    } else {
      const far = cameraMode === 1
      const dist = (far ? 12.5 : 8.2) * (1 + Math.max(0, speed) / 260)
      const height = (far ? 5.2 : 3.1)
      camDesired.set(target.x - hx * dist, target.y + height, target.z - hz * dist)
      camLookDesired.set(target.x + hx * 5.5, target.y + 1.1, target.z + hz * 5.5)
      const gy = world.carHeight(camDesired.x, camDesired.z, t.nearest(camDesired.x, camDesired.z, target.idx)) + 1.1
      if (camDesired.y < gy) camDesired.y = gy
      if (camReset) {
        camPos.copy(camDesired)
        camLook.copy(camLookDesired)
        camReset = false
      }
      const k = 1 - Math.exp(-dt * 6.5)
      camPos.lerp(camDesired, k)
      camLook.lerp(camLookDesired, 1 - Math.exp(-dt * 12))
      fovTarget = 60 + (boosting ? 12 : 0) + Math.max(0, speed - 30) * 0.15
    }
    if (own && phase === 'racing') {
      const rough = (own.off ? 0.06 : own.shoulder ? 0.035 : 0) * Math.min(1, Math.abs(speed) / 12)
      camShake = Math.max(camShake * Math.exp(-dt * 6), rough > 0 ? rough * 4 : 0)
    } else camShake *= Math.exp(-dt * 6)
  } else {
    // Lobby / spectator orbit
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    const ang = simTime * 0.06
    const rad = Math.max(t.maxX - t.minX, t.maxZ - t.minZ) * 0.55
    camDesired.set(cx + Math.cos(ang) * rad, 80 + Math.sin(simTime * 0.2) * 10, cz + Math.sin(ang) * rad)
    camLookDesired.set(cx, 8, cz)
    if (camReset) {
      camPos.copy(camDesired)
      camLook.copy(camLookDesired)
      camReset = false
    }
    camPos.lerp(camDesired, 1 - Math.exp(-dt * 2))
    camLook.lerp(camLookDesired, 1 - Math.exp(-dt * 2))
    fovTarget = 55
    camShake = 0
  }
  camera.position.copy(camPos)
  if (camShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * camShake * 0.25
    camera.position.y += (Math.random() - 0.5) * camShake * 0.25
    camera.position.z += (Math.random() - 0.5) * camShake * 0.25
  }
  camera.lookAt(camLook)
  camFov += (fovTarget - camFov) * Math.min(1, dt * 5)
  if (Math.abs(camera.fov - camFov) > 0.01) {
    camera.fov = camFov
    camera.updateProjectionMatrix()
  }
  // Sun shadow follows the point of interest
  const fx = target ? target.x : camLook.x
  const fz = target ? target.z : camLook.z
  const fy = target ? target.y : camLook.y
  sun.target.position.set(fx, fy, fz)
  sun.position.set(fx, fy, fz).addScaledVector(world.sunDir, 380)
  sun.target.updateMatrixWorld()
}

// ---------- minimap ----------
let miniBg = null
let miniXf = null
function buildMinimap () {
  const dpr = 2
  const W = 240 * dpr
  const H = 160 * dpr
  elMini.width = W
  elMini.height = H
  miniBg = document.createElement('canvas')
  miniBg.width = W
  miniBg.height = H
  const g = miniBg.getContext('2d')
  const pad = 16 * dpr
  const sx = (W - pad * 2) / (track.maxX - track.minX)
  const sz = (H - pad * 2) / (track.maxZ - track.minZ)
  const s = Math.min(sx, sz)
  const ox = (W - (track.maxX - track.minX) * s) / 2
  const oz = (H - (track.maxZ - track.minZ) * s) / 2
  miniXf = { s, ox, oz }
  g.lineCap = g.lineJoin = 'round'
  const path = () => {
    g.beginPath()
    track.pts.forEach((p, i) => {
      const x = ox + (p.x - track.minX) * s
      const y = oz + (p.z - track.minZ) * s
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.closePath()
  }
  path()
  g.lineWidth = 9 * dpr
  g.strokeStyle = 'rgba(0,0,0,0.5)'
  g.stroke()
  path()
  g.lineWidth = 6 * dpr
  g.strokeStyle = '#8a8f96'
  g.stroke()
  const p0 = track.pts[0]
  g.strokeStyle = '#fff'
  g.lineWidth = 3 * dpr
  g.beginPath()
  g.moveTo(ox + (p0.x - track.minX) * s - p0.tz * 6 * dpr, oz + (p0.z - track.minZ) * s + p0.tx * 6 * dpr)
  g.lineTo(ox + (p0.x - track.minX) * s + p0.tz * 6 * dpr, oz + (p0.z - track.minZ) * s - p0.tx * 6 * dpr)
  g.stroke()
}

function drawMinimap () {
  if (!miniBg || !miniXf) return
  const g = elMini.getContext('2d')
  g.clearRect(0, 0, elMini.width, elMini.height)
  g.drawImage(miniBg, 0, 0)
  const { s, ox, oz } = miniXf
  const dot = (x, z, col, r, ring) => {
    const mx = ox + (x - track.minX) * s
    const mz = oz + (z - track.minZ) * s
    g.beginPath()
    g.arc(mx, mz, r, 0, 7)
    g.fillStyle = col
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = ring || 'rgba(0,0,0,0.6)'
    g.stroke()
  }
  for (const r of remote.values()) dot(r.x, r.z, r.col, 7, null)
  if (own) dot(own.x, own.z, me.color, 9, '#ffd54f')
}

// ---------- HUD ----------
let noticeTimer = 0
function showNotice (text) {
  elNotice.textContent = text
  elNotice.classList.add('show')
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => elNotice.classList.remove('show'), 1600)
}

function fmtClock (ms) {
  const s = ms / 1000
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1)
}

function rebuildStandings () {
  sorted = [...carsSnap].sort((A, B) => (B.fin - A.fin) || ((B.l + B.p) - (A.l + A.p)))
  let html = ''
  const showPlace = phase === 'racing' || phase === 'finished'
  sorted.forEach((c, i) => {
    const self = me && c.id === me.id
    html += `<div class="row${self ? ' self' : ''}"><span class="pos">${i + 1}</span><span class="chip" style="background:${c.col}"></span><span class="nm">${self ? '<b>' + esc(c.n) + '</b>' : esc(c.n)}</span><span class="lp">${c.fin ? '\u{1F3C1}' : 'L' + Math.min(c.l + 1, LAPS)}</span></div>`
    // Place badge over every rival's car (our own car never carries a label).
    const r = remote.get(c.id)
    if (r && r.car) r.car.setLabel(c.n, showPlace ? i + 1 : 0)
  })
  elStand.innerHTML = html
}

let hudAcc = 0
function hud (dt) {
  hudAcc += dt
  // speed & boost every frame (cheap)
  if (own && (phase === 'racing' || phase === 'finished' || phase === 'countdown')) {
    elSpeedo.style.display = 'flex'
    const kmh = Math.max(0, Math.round(own.fwd * 3.6))
    elSpeedVal.textContent = kmh
    const f = Math.min(1, kmh / 240)
    elGaugeArc.setAttribute('stroke-dashoffset', String(267 - 267 * f))
    elGaugeArc.setAttribute('stroke', own.boosting || own.turbo > 0 ? '#ff6d00' : own.off ? '#ef5350' : '#ffd54f')
    elBoost.style.width = (own.boost * 100).toFixed(0) + '%'
    elBoost.className = own.boost >= 0.5 && own.boostCd <= 0 ? 'ready' : ''
  } else {
    elSpeedo.style.display = 'none'
  }
  elMini.style.display = world && (own || phase === 'racing' || phase === 'finished') ? 'block' : 'none'
  if (hudAcc < 0.1) return
  hudAcc = 0

  let pm = ''
  let sm = ''
  const n = carsSnap.length
  if (phase === 'lobby') {
    if (tl < 0) {
      pm = 'WAITING FOR RACERS'
      sm = mapName + ' • click JOIN RACE to start the 30-second countdown'
    } else {
      pm = 'RACE STARTS IN ' + Math.ceil(tl) + 's'
      sm = joined
        ? mapName + ' • you are on the grid (' + n + '/' + MAX_PLAYERS + ') — get ready!'
        : mapName + ' • ' + n + '/' + MAX_PLAYERS + ' on the grid — click JOIN RACE to enter'
    }
    if (voteOpen) sm += ' • vote for the next map'
  } else if (phase === 'countdown') {
    pm = ''
    sm = joined ? 'Lights out and away we go…' : 'Spectating — next race opens after this one'
  } else if (phase === 'racing') {
    if (!joined) {
      pm = 'RACE IN PROGRESS'
      sm = 'Spectating the leader — the next lobby opens when this race ends'
    } else if (gl >= 0 && own && !own.fin) {
      pm = 'LEADER FINISHED — ' + Math.ceil(gl) + 's LEFT'
      sm = 'Finish before the timer runs out!'
    } else if (own && own.fin) {
      pm = 'FINISHED!'
      sm = gl >= 0 ? 'Waiting for the others (' + Math.ceil(gl) + 's)…' : ''
    }
  } else if (phase === 'finished') {
    pm = 'RACE OVER'
    sm = joined ? 'Next race starts shortly — you stay on the grid' : 'Next lobby opens shortly…'
  }
  elPhase.textContent = pm
  elSub.textContent = sm

  if (phase === 'countdown') {
    const c = Math.ceil(tl)
    if (c !== lastCount) {
      lastCount = c
      elBig.textContent = c > 0 ? c : 'GO!'
      elBig.classList.remove('pop')
      void elBig.offsetWidth
      elBig.classList.add('pop')
      audio.countdown(c)
      if (world) world.setStartLights(Math.min(5, 5 - c + 1), c <= 0)
    }
  } else if (goPending) {
    goPending = false
    lastCount = 0
    elBig.textContent = 'GO!'
    elBig.className = 'pop'
    audio.countdown(0)
    if (world) world.setStartLights(0, true)
    setTimeout(() => { elBig.className = '' }, 900)
  } else if (phase === 'lobby' && world) {
    world.setStartLights(0, false)
  }

  const canJoin = phase === 'lobby' && connected && !joined && ws.readyState === 1
  elJoinWrap.style.display = phase === 'lobby' && (canJoin || joined) ? 'block' : 'none'
  elMapVote.style.display = phase === 'lobby' && voteTiles.length ? 'block' : 'none'
  elBtn.disabled = !canJoin
  elBtn.textContent = joined ? 'ON THE GRID ✓' : 'JOIN RACE'
  elName.disabled = !(connected && ws.readyState === 1)
  // The server locks the car from countdown until results clear; the panel is only shown in the lobby anyway.
  setPickerLocked(!(connected && ws.readyState === 1) || phase !== 'lobby')
  elLeave.style.display = joined && phase === 'lobby' ? 'inline-block' : 'none'

  let info = ''
  if ((phase === 'racing' || phase === 'finished' || phase === 'countdown') && joined && own) {
    if (own.fin) info += '<b>\u{1F3C1} FINISHED</b><br>'
    else info += '<b>LAP ' + Math.min(own.lap + 1, LAPS) + '/' + LAPS + '</b><br>'
    info += fmtClock(phase === 'finished' ? resTime(me.id) : clock) + '<br>'
    const pi = sorted.findIndex(c => c.id === me.id)
    if (pi >= 0) info += 'P' + (pi + 1) + '/' + sorted.length
    if (gl >= 0 && !own.fin && phase === 'racing') info += '<br><span class="grace">⏱ ' + Math.ceil(gl) + 's</span>'
  } else if (phase === 'racing' && !joined) {
    info = 'SPECTATING'
  }
  elInfo.innerHTML = info

  if (res && phase === 'finished') {
    let html = '<h2>RACE RESULTS</h2>'
    for (const r of res) {
      html += `<div class="rrow${me && r.id === me.id ? ' self' : ''}"><span class="pos${r.pos === 1 ? ' first' : ''}">${r.pos === 1 ? '\u{1F3C6}' : r.pos}</span><span class="chip" style="background:${r.color}"></span><span class="nm">${esc(r.name)}</span><span class="tm">${r.time ? fmtClock(r.time) : 'DNF (' + r.laps + '/' + LAPS + ')'}</span></div>`
    }
    html += `<div class="next">${mapName} • next race in ${Math.ceil(tl)}s</div>`
    elResults.innerHTML = html
    elResults.style.display = 'block'
  } else {
    elResults.style.display = 'none'
  }

  if (standingsDirty) {
    standingsDirty = false
    rebuildStandings()
  }
}

function resTime (id) {
  const r = res && res.find(x => x.id === id)
  return r && r.time ? r.time : clock
}

// ---------- main loop ----------
const fpsWindow = []
let fpsAcc = 0
let autoDropped = localStorage.getItem('race.autodrop') === '1'

function loop () {
  requestAnimationFrame(loop)
  clockT.update()
  let dt = clockT.getDelta()
  if (dt > 0.05) dt = 0.05
  tick(dt, true)
}

function tick (dt, render) {
  simTime += dt
  if (loadingWorld || !world) {
    hud(dt)
    return
  }
  step(dt)
  if (own && ownCar) {
    placeCar(ownCar, own.x, own.y, own.z, own.a, own.quat, own.normal, own.slipVis)
    ownCar.animate(dt, own.fwd, own.steer, !!keys.brake && phase === 'racing', own.boosting || own.turbo > 0, simTime, own.drifting ? (own.driftDir || 2) : 0)
    if (connected && ws.readyState === 1) {
      sendAcc += dt
      if (sendAcc > 0.05) {
        sendAcc = 0
        const flags = (own.drifting ? 1 : 0) | (own.boosting || own.turbo > 0 ? 2 : 0) | (keys.brake && phase === 'racing' ? 4 : 0) | (own.drifting && own.driftDir < 0 ? 8 : 0) | (own.drifting && own.driftDir === 0 ? 16 : 0)
        ws.send(JSON.stringify({ t: 'st', q: [+own.x.toFixed(2), +own.z.toFixed(2), +own.a.toFixed(3), own.lap, +own.prog.toFixed(4), +own.fwd.toFixed(1), flags] }))
      }
    }
    audio.engine(own.fwd, phase === 'racing' && !own.fin && !keys.brake ? 1 : 0, own.drifting ? 1 : Math.min(1, Math.abs(own.lat) / 8), own.off ? 1 : 0, own.boosting ? 1 : own.turbo > 0 ? 0.5 : 0, true)
  } else {
    audio.engine(0, 0, 0, 0, 0, false)
  }
  updateRemotes(dt, performance.now())
  world.update(simTime, dt)
  smoke.update(dt)
  sparks.update(dt)
  skids.uTime.value = simTime
  skids.flush()
  updateCamera(dt)
  if (render) {
    if (composer) composer.render()
    else renderer.render(scene, camera)
    drawMinimap()
  }
  hud(dt)

  // FPS + auto quality fallback
  if (!render) return
  fpsWindow.push(dt)
  fpsAcc += dt
  if (fpsAcc > 1) {
    const avg = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length
    const fps = 1 / avg
    elFps.textContent = fps.toFixed(0) + ' fps · ' + qualityName
    if (fpsWindow.length > 90 && fps < 27 && qualityName === 'ultra' && !autoDropped) {
      autoDropped = true
      localStorage.setItem('race.autodrop', '1')
      qualityName = 'high'
      elQuality.value = 'high'
      localStorage.setItem('race.quality', 'high')
      showNotice('GRAPHICS SET TO HIGH')
      applyQuality()
    }
    fpsWindow.length = 0
    fpsAcc = 0
  }
}

window.__game = { scene, camera, renderer, keys, tick, get sorted () { return sorted }, get composer () { return composer }, get aoPass () { return aoPass }, get bloomPass () { return bloomPass }, get world () { return world }, get own () { return own }, get phase () { return phase }, remote, get track () { return track } }
connect()
loop()
