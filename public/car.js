// Procedural car model. Nose points along local +x; wheels spin around local z.
// Four body styles (see /shared/cars.js) share one footprint: ~4.2 long (x),
// ~2 wide (z), ground at y = 0, wheel pivots at the same four positions.
import * as THREE from 'three'
import { carLabelTexture } from './textures.js'
import { CAR_STYLES, clampStyle } from '/shared/cars.js'

export function carStyleCount () {
  return CAR_STYLES.length
}

const WHEEL_POS = [[1.35, -0.98], [1.35, 0.98], [-1.35, -0.98], [-1.35, 0.98]]
// Rival name labels fade out as the camera closes in: hidden at LABEL_MIN_DIST
// world units, fully shown from LABEL_FADE_DIST (about two car lengths) out.
const LABEL_MIN_DIST = 7
const LABEL_FADE_DIST = 14
const _labelPos = new THREE.Vector3()

// Materials and geometry that do not depend on the style or the paint colour.
let COMMON = null
function common () {
  if (COMMON) return COMMON
  const flameGeo = new THREE.ConeGeometry(0.13, 0.9, 10)
  flameGeo.rotateZ(Math.PI / 2)
  flameGeo.translate(-0.45, 0, 0)
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.92 })
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f1a24, roughness: 0.05, metalness: 0.4, envMapIntensity: 1.6, clearcoat: 1 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.6 })
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.95 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.2 })
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  COMMON = { flameGeo, tyreMat, rimMat, glassMat, trimMat, seatMat, headMat, flameMat }
  return COMMON
}

// A wheel set: tyre + rim + two crossed spokes, plus an optional extra ring (buggy tread).
function wheelSet (r, width, segments = 20, rimR = r * 0.65, tread = null) {
  const tyreGeo = new THREE.CylinderGeometry(r, r, width, segments)
  tyreGeo.rotateX(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(rimR, rimR, width + 0.02, 12)
  rimGeo.rotateX(Math.PI / 2)
  const spokeGeo = new THREE.BoxGeometry(rimR + 0.16, 0.07, width + 0.04)
  let treadGeo = null
  if (tread) {
    treadGeo = new THREE.CylinderGeometry(r + tread.bump, r + tread.bump, width * 0.8, tread.lumps)
    treadGeo.rotateX(Math.PI / 2)
  }
  return { r, tyreGeo, rimGeo, spokeGeo, treadGeo }
}

// Thin cylinder from point a to point b (roll-cage tubes, rails).
function tube (radius, a, b) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = d.length()
  const g = new THREE.CylinderGeometry(radius, radius, len, 6)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  g.applyQuaternion(q)
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  return g
}

function profile (points) {
  const s = new THREE.Shape()
  s.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1])
  s.closePath()
  return s
}

// Part descriptors: { geo, mat, pos, rot?, shadow?, receive? }
// mat is a shared material, or the string 'paint' / 'tail' for the per-car ones.
function part (geo, mat, pos = [0, 0, 0], extra = {}) {
  return { geo, mat, pos, ...extra }
}

// ---- Style 0: racer (the original coupe, geometry unchanged) --------------
function buildRacer (C) {
  const body = new THREE.Shape()
  body.moveTo(-2.0, 0.34)
  body.lineTo(-2.05, 0.7)
  body.lineTo(-1.75, 0.86)
  body.lineTo(-1.2, 0.9)
  body.lineTo(1.2, 0.9)
  body.lineTo(1.7, 0.84)
  body.lineTo(2.05, 0.76)
  body.lineTo(2.1, 0.38)
  body.lineTo(1.7, 0.32)
  body.lineTo(-1.7, 0.32)
  body.closePath()
  const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 3, curveSegments: 4 })
  bodyGeo.translate(0, 0, -0.75)

  const cabin = new THREE.Shape()
  cabin.moveTo(-1.25, 0.86)
  cabin.lineTo(-0.8, 1.3)
  cabin.lineTo(0.35, 1.36)
  cabin.lineTo(0.95, 1.08)
  cabin.lineTo(1.45, 0.86)
  cabin.closePath()
  const glassGeo = new THREE.ExtrudeGeometry(cabin, { depth: 1.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 })
  glassGeo.translate(0, 0, -0.67)
  const roofGeo = new THREE.BoxGeometry(1.15, 0.07, 1.42)
  roofGeo.translate(-0.22, 1.37, 0)

  const headGeo = new THREE.BoxGeometry(0.08, 0.16, 0.4)
  const tailGeo = new THREE.BoxGeometry(0.06, 0.14, 0.5)
  const spoilerGeo = new THREE.BoxGeometry(0.35, 0.06, 1.7)
  const strutGeo = new THREE.BoxGeometry(0.12, 0.34, 0.08)
  const bumperGeo = new THREE.BoxGeometry(0.16, 0.2, 1.62)
  const mirrorGeo = new THREE.BoxGeometry(0.12, 0.1, 0.22)

  const parts = [
    part(bodyGeo, 'paint', [0, 0, 0], { shadow: true, receive: true }),
    part(glassGeo, C.glassMat, [0, 0, 0], { shadow: true }),
    part(roofGeo, 'paint', [0, 0, 0], { shadow: true }),
    part(spoilerGeo, 'paint', [-1.95, 1.2, 0], { shadow: true })
  ]
  for (const z of [-0.6, 0.6]) {
    parts.push(part(strutGeo, C.trimMat, [-1.9, 1.0, z]))
    parts.push(part(headGeo, C.headMat, [2.17, 0.6, z]))
    parts.push(part(tailGeo, 'tail', [-2.12, 0.58, z]))
    parts.push(part(mirrorGeo, 'paint', [0.95, 1.0, z * 1.5]))
  }
  for (const x of [2.13, -2.1]) parts.push(part(bumperGeo, C.trimMat, [x, 0.36, 0]))

  const w = wheelSet(0.37, 0.3, 20, 0.24)
  return { parts, flames: [[-2.15, 0.36, -0.45], [-2.15, 0.36, 0.45]], front: w, rear: w }
}

// ---- Style 1: muscle -------------------------------------------------------
function buildMuscle (C) {
  const bodyGeo = new THREE.ExtrudeGeometry(profile([
    [-2.05, 0.3], [-2.1, 0.96], [-1.6, 1.0], [-0.2, 0.98], [1.4, 0.92], [2.05, 0.84], [2.1, 0.36], [1.7, 0.3], [-1.7, 0.3]
  ]), { depth: 1.6, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 3, curveSegments: 4 })
  bodyGeo.translate(0, 0, -0.8)

  // Cabin sits far back over the rear axle
  const glassGeo = new THREE.ExtrudeGeometry(profile([
    [-1.7, 0.98], [-1.4, 1.42], [-0.4, 1.44], [0.35, 0.96]
  ]), { depth: 1.4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 })
  glassGeo.translate(0, 0, -0.7)
  const roofGeo = new THREE.BoxGeometry(0.95, 0.07, 1.48)
  roofGeo.translate(-0.9, 1.45, 0)

  const scoopGeo = new THREE.BoxGeometry(0.75, 0.13, 0.5)
  const spoilerGeo = new THREE.BoxGeometry(0.34, 0.08, 1.6)
  const headGeo = new THREE.BoxGeometry(0.08, 0.2, 0.34)
  const tailGeo = new THREE.BoxGeometry(0.06, 0.12, 0.72)
  const bumperGeo = new THREE.BoxGeometry(0.16, 0.22, 1.72)
  const mirrorGeo = new THREE.BoxGeometry(0.12, 0.1, 0.22)
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10)
  pipeGeo.rotateZ(Math.PI / 2)

  const parts = [
    part(bodyGeo, 'paint', [0, 0, 0], { shadow: true, receive: true }),
    part(glassGeo, C.glassMat, [0, 0, 0], { shadow: true }),
    part(roofGeo, 'paint', [0, 0, 0], { shadow: true }),
    part(scoopGeo, C.trimMat, [1.0, 1.0, 0], { shadow: true }),
    // Ducktail: low lip kicked up at the back (positive z-rotation lifts the -x end)
    part(spoilerGeo, 'paint', [-2.02, 1.05, 0], { rot: [0, 0, 0.32], shadow: true })
  ]
  for (const z of [-0.6, 0.6]) {
    parts.push(part(headGeo, C.headMat, [2.17, 0.62, z]))
    parts.push(part(mirrorGeo, 'paint', [0.32, 1.06, z * 1.62]))
    parts.push(part(pipeGeo, C.rimMat, [-2.15, 0.26, z * 0.95]))
  }
  for (const z of [-0.45, 0.45]) parts.push(part(tailGeo, 'tail', [-2.17, 0.72, z]))
  for (const x of [2.13, -2.12]) parts.push(part(bumperGeo, C.rimMat, [x, 0.34, 0]))

  return {
    parts,
    flames: [[-2.25, 0.26, -0.57], [-2.25, 0.26, 0.57]],
    front: wheelSet(0.36, 0.3, 20, 0.23),
    rear: wheelSet(0.4, 0.44, 20, 0.25)
  }
}

// ---- Style 2: buggy (open-wheel, roll cage) --------------------------------
function buildBuggy (C) {
  const tubGeo = new THREE.ExtrudeGeometry(profile([
    [-1.95, 0.26], [-1.98, 0.62], [-0.7, 0.66], [-0.3, 0.56], [1.1, 0.56], [1.55, 0.6], [1.6, 0.26]
  ]), { depth: 1.1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 4 })
  tubGeo.translate(0, 0, -0.55)
  const noseGeo = new THREE.ExtrudeGeometry(profile([
    [1.5, 0.28], [1.5, 0.6], [2.1, 0.44], [2.1, 0.3]
  ]), { depth: 0.6, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 3 })
  noseGeo.translate(0, 0, -0.3)
  // Side pods over the tub edge in paint
  const podGeo = new THREE.BoxGeometry(1.2, 0.18, 0.28)

  // Roll cage in trim tubes
  const R = 0.04
  const cage = [
    tube(R, [-0.6, 0.6, -0.5], [-0.6, 1.5, -0.5]),
    tube(R, [-0.6, 0.6, 0.5], [-0.6, 1.5, 0.5]),
    tube(R, [-0.6, 1.5, -0.5], [-0.6, 1.5, 0.5]),
    tube(R, [-0.6, 1.5, -0.5], [0.95, 0.6, -0.5]),
    tube(R, [-0.6, 1.5, 0.5], [0.95, 0.6, 0.5]),
    tube(R, [0.2, 1.04, -0.5], [0.2, 1.04, 0.5]),
    tube(R, [-0.6, 1.5, -0.5], [-1.7, 0.66, -0.4]),
    tube(R, [-0.6, 1.5, 0.5], [-1.7, 0.66, 0.4]),
    tube(R, [-0.6, 1.1, -0.5], [-0.6, 1.1, 0.5]),
    // Bull bar across the nose tip
    tube(R * 0.9, [2.15, 0.5, -0.36], [2.15, 0.5, 0.36])
  ]
  const seatGeo = new THREE.BoxGeometry(0.6, 0.12, 0.6)
  const backGeo = new THREE.BoxGeometry(0.14, 0.62, 0.6)
  const restGeo = new THREE.BoxGeometry(0.16, 0.26, 0.34)
  const engineGeo = new THREE.BoxGeometry(0.7, 0.42, 0.8)
  const filterGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10)
  const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8)
  pipeGeo.rotateZ(Math.PI / 2)
  const headGeo = new THREE.BoxGeometry(0.1, 0.16, 0.2)
  const tailGeo = new THREE.BoxGeometry(0.06, 0.14, 0.28)
  const wingGeo = new THREE.BoxGeometry(0.28, 0.05, 1.3)

  const parts = [
    part(tubGeo, 'paint', [0, 0, 0], { shadow: true, receive: true }),
    part(noseGeo, 'paint', [0, 0, 0], { shadow: true }),
    part(wingGeo, 'paint', [1.95, 0.52, 0], { shadow: true }),
    part(seatGeo, C.seatMat, [-0.05, 0.62, 0]),
    part(backGeo, C.seatMat, [-0.42, 0.9, 0], { rot: [0, 0, 0.18], shadow: true }),
    part(restGeo, C.seatMat, [-0.5, 1.28, 0]),
    part(engineGeo, C.trimMat, [-1.25, 0.82, 0], { shadow: true }),
    part(filterGeo, C.rimMat, [-1.15, 1.12, 0.22])
  ]
  for (const g of cage) parts.push(part(g, C.trimMat, [0, 0, 0], { shadow: true }))
  for (const z of [-1, 1]) {
    parts.push(part(podGeo, 'paint', [0.2, 0.5, z * 0.7], { shadow: true }))
    parts.push(part(headGeo, C.headMat, [1.55, 0.67, z * 0.34]))
    parts.push(part(tailGeo, 'tail', [-2.0, 0.5, z * 0.36]))
    parts.push(part(pipeGeo, C.rimMat, [-1.75, 0.72, z * 0.3]))
  }

  const w = wheelSet(0.45, 0.4, 12, 0.24, { bump: 0.02, lumps: 8 })
  return { parts, flames: [[-2.05, 0.72, -0.3], [-2.05, 0.72, 0.3]], front: w, rear: w }
}

// ---- Style 3: van ----------------------------------------------------------
function buildVan (C) {
  const bodyGeo = new THREE.ExtrudeGeometry(profile([
    [-2.0, 0.3], [-2.06, 1.84], [-1.88, 1.92], [0.6, 1.92], [0.86, 1.84], [1.5, 0.96], [1.62, 0.9], [2.05, 0.86], [2.1, 0.36], [1.7, 0.3], [-1.7, 0.3]
  ]), { depth: 1.6, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 3, curveSegments: 4 })
  bodyGeo.translate(0, 0, -0.8)

  // Big flat windscreen lying on the slope from (0.86,1.84) to (1.5,0.96)
  const screenGeo = new THREE.BoxGeometry(0.06, 1.0, 1.44)
  const sideFrontGeo = new THREE.BoxGeometry(0.72, 0.6, 0.06)
  const sideRearGeo = new THREE.BoxGeometry(1.0, 0.55, 0.06)
  const rearGlassGeo = new THREE.BoxGeometry(0.06, 0.55, 1.2)
  const roofGeo = new THREE.BoxGeometry(2.5, 0.06, 1.56)
  const railGeo = new THREE.BoxGeometry(2.1, 0.06, 0.06)
  const barGeo = new THREE.BoxGeometry(0.06, 0.06, 1.3)
  const ladderRailGeo = new THREE.BoxGeometry(0.05, 1.5, 0.05)
  const rungGeo = new THREE.BoxGeometry(0.05, 0.05, 0.44)
  const headGeo = new THREE.BoxGeometry(0.08, 0.2, 0.34)
  const tailGeo = new THREE.BoxGeometry(0.06, 0.34, 0.16)
  const bumperGeo = new THREE.BoxGeometry(0.16, 0.22, 1.72)
  const mirrorGeo = new THREE.BoxGeometry(0.1, 0.16, 0.2)
  const grilleGeo = new THREE.BoxGeometry(0.06, 0.2, 0.7)

  const parts = [
    part(bodyGeo, 'paint', [0, 0, 0], { shadow: true, receive: true }),
    part(screenGeo, C.glassMat, [1.215, 1.43, 0], { rot: [0, 0, 0.626] }),
    part(rearGlassGeo, C.glassMat, [-2.09, 1.45, 0]),
    part(roofGeo, 'paint', [-0.64, 1.95, 0], { shadow: true }),
    part(grilleGeo, C.trimMat, [2.13, 0.64, 0])
  ]
  for (const z of [-0.87, 0.87]) {
    parts.push(part(sideFrontGeo, C.glassMat, [0.3, 1.42, z]))
    parts.push(part(sideRearGeo, C.glassMat, [-0.95, 1.42, z]))
  }
  for (const z of [-0.6, 0.6]) parts.push(part(railGeo, C.trimMat, [-0.64, 2.04, z], { shadow: true }))
  for (const x of [-1.5, -0.64, 0.22]) parts.push(part(barGeo, C.trimMat, [x, 2.04, 0]))
  for (const z of [-0.22, 0.22]) parts.push(part(ladderRailGeo, C.trimMat, [-2.14, 1.1, z]))
  for (let y = 0.5; y < 1.8; y += 0.3) parts.push(part(rungGeo, C.trimMat, [-2.14, y, 0]))
  for (const z of [-1, 1]) {
    parts.push(part(headGeo, C.headMat, [2.17, 0.64, z * 0.55]))
    parts.push(part(tailGeo, 'tail', [-2.1, 0.72, z * 0.66]))
    parts.push(part(mirrorGeo, 'paint', [1.35, 1.38, z * 0.98]))
  }
  for (const x of [2.13, -2.12]) parts.push(part(bumperGeo, C.trimMat, [x, 0.36, 0]))

  const w = wheelSet(0.33, 0.28, 20, 0.2)
  return { parts, flames: [[-2.15, 0.36, -0.45], [-2.15, 0.36, 0.45]], front: w, rear: w }
}

const BUILDERS = [buildRacer, buildMuscle, buildBuggy, buildVan]

// Geometry per style, built once and shared by every car of that style.
const SHARED = []
function sharedFor (idx) {
  if (!SHARED[idx]) SHARED[idx] = BUILDERS[idx](common())
  return SHARED[idx]
}

export class Car {
  constructor (colorHex, name, isSelf, style = 0) {
    this.style = clampStyle(style)
    const C = common()
    const S = sharedFor(this.style)
    this.group = new THREE.Group()
    this.color = new THREE.Color(colorHex)
    this.paint = new THREE.MeshPhysicalMaterial({
      color: this.color,
      metalness: 0.35,
      roughness: 0.38,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.7
    })
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a1a, emissiveIntensity: 0.6 })

    for (const p of S.parts) {
      const mat = p.mat === 'paint' ? this.paint : p.mat === 'tail' ? this.tailMat : p.mat
      const m = new THREE.Mesh(p.geo, mat)
      m.position.set(p.pos[0], p.pos[1], p.pos[2])
      if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2])
      if (p.shadow) m.castShadow = true
      if (p.receive) m.receiveShadow = true
      this.group.add(m)
    }
    this.flames = []
    for (const [x, y, z] of S.flames) {
      const f = new THREE.Mesh(C.flameGeo, C.flameMat)
      f.position.set(x, y, z)
      f.visible = false
      f.userData.noAO = true
      this.group.add(f)
      this.flames.push(f)
    }
    this.frontWheels = []
    this.rearWheels = []
    this.frontSpins = []
    this.rearSpins = []
    this.tyreR = S.front.r
    for (const [x, z] of WHEEL_POS) {
      const W = x > 0 ? S.front : S.rear
      const pivot = new THREE.Group()
      pivot.position.set(x, W.r, z)
      const spin = new THREE.Group()
      const tyre = new THREE.Mesh(W.tyreGeo, C.tyreMat)
      tyre.castShadow = true
      const rim = new THREE.Mesh(W.rimGeo, C.rimMat)
      const spoke = new THREE.Mesh(W.spokeGeo, C.rimMat)
      const spoke2 = new THREE.Mesh(W.spokeGeo, C.rimMat)
      spoke2.rotation.z = Math.PI / 2
      spin.add(tyre, rim, spoke, spoke2)
      if (W.treadGeo) {
        const tread = new THREE.Mesh(W.treadGeo, C.tyreMat)
        tread.rotation.z = Math.PI / 8
        spin.add(tread)
      }
      pivot.add(spin)
      this.group.add(pivot)
      if (x > 0) {
        this.frontWheels.push(pivot)
        this.frontSpins.push(spin)
      } else {
        this.rearWheels.push(pivot)
        this.rearSpins.push(spin)
      }
    }
    // Floating name / place label — rivals only, never over our own car.
    this.label = null
    this.labelName = ''
    this.labelPlace = 0
    if (!isSelf) {
      const sm = new THREE.SpriteMaterial({ map: carLabelTexture(name, 0), transparent: true, depthTest: false })
      const sprite = new THREE.Sprite(sm)
      sprite.scale.set(6.3, 1.05, 1)
      sprite.position.set(0, 2.5, 0)
      sprite.renderOrder = 10
      this.group.add(sprite)
      this.label = sprite
      this.labelName = name
    }
    this.wheelRot = 0
    this.rearRot = 0
    this.steerVis = 0
    this.rearVis = 0
  }

  // Visual update: speed (m/s), steer (-1..1), brake, boost flags, time (s),
  // drift (0 = none, -1/1 = directional drift, 2 = neutral drift with no steer locked yet)
  animate (dt, speed, steer, braking, boosting, time, drift = 0) {
    this.wheelRot += speed * dt / this.tyreR
    for (const w of this.frontSpins) w.rotation.z = -this.wheelRot
    // Rear tyres overspin while drifting so the back end visibly churns; churn at least a minimum rate.
    if (drift) {
      const dir = speed < 0 ? -1 : 1
      this.rearRot += dir * Math.max(Math.abs(speed) * 1.7, 14) * dt / this.tyreR
    } else {
      this.rearRot += speed * dt / this.tyreR
    }
    for (const w of this.rearSpins) w.rotation.z = -this.rearRot
    this.steerVis += (steer * 0.45 - this.steerVis) * Math.min(1, dt * 12)
    for (const f of this.frontWheels) f.rotation.y = -this.steerVis
    // Rear pivots cock sideways while drifting: toward the drift direction, or wagging with the tail when neutral.
    const rearTarget = drift === 2 ? Math.sin(time * 7) * 0.18 : drift ? drift * 0.18 : 0
    this.rearVis += (rearTarget - this.rearVis) * Math.min(1, dt * 12)
    for (const r of this.rearWheels) r.rotation.y = -this.rearVis
    this.tailMat.emissiveIntensity = braking ? 3.5 : 0.7
    for (const f of this.flames) {
      f.visible = boosting
      if (boosting) {
        const s = 0.8 + Math.sin(time * 60 + f.position.z * 10) * 0.25 + Math.random() * 0.15
        f.scale.set(s * 1.3, s, s)
      }
    }
  }

  // Redraw the label when the driver renames or changes position (place 0 = no badge).
  setLabel (name, place) {
    if (!this.label) return
    if (name === this.labelName && place === this.labelPlace) return
    this.labelName = name
    this.labelPlace = place
    const old = this.label.material.map
    this.label.material.map = carLabelTexture(name, place)
    this.label.material.needsUpdate = true
    if (old) old.dispose()
  }

  // Opacity from the label's distance to the camera; call once per frame after
  // the camera has moved. Only the material changes, the sprite stays put.
  updateLabelVisibility (cameraPos) {
    if (!this.label) return
    // The group sits directly in the scene, so its position + rotation place the label.
    _labelPos.copy(this.label.position).applyQuaternion(this.group.quaternion).add(this.group.position)
    const d = _labelPos.distanceTo(cameraPos)
    const o = Math.max(0, Math.min(1, (d - LABEL_MIN_DIST) / (LABEL_FADE_DIST - LABEL_MIN_DIST)))
    this.label.material.opacity = o
    this.label.visible = o > 0.01
  }

  dispose () {
    this.paint.dispose()
    this.tailMat.dispose()
    if (this.label) {
      this.label.material.map.dispose()
      this.label.material.dispose()
    }
  }
}
