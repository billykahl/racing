// Builds the 3D world for a track: hilly terrain, asphalt ribbon, curbs,
// barriers, ponds, forests, grandstand, start gantry, sky and ambient props.
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { HALF_W, SHOULDER, WALL_DIST } from '/shared/track.js'
import { mulberry32, fbm, smooth01, clamp, lerp } from './noise.js'
import * as T from './textures.js'

const CELL = 2.5
const MARGIN = 150
const FAR = 2600
const TRACK_LIFT = 0.03
const VERGE_DROP = 0.17
const BLEND_W = 55

let TEX = null
function textures () {
  if (TEX) return TEX
  TEX = {
    asphalt: T.asphaltTexture(),
    curb: T.curbTexture(),
    gravel: T.gravelTexture(),
    grass: T.grassTexture(),
    metal: T.metalTexture(),
    concrete: T.concreteTexture(),
    wood: T.woodTexture(),
    blade: T.grassBladeTexture(),
    cloud: T.cloudTexture(),
    waterN: T.waterNormalTexture(),
    banner: T.bannerTexture('FINISH', '#0d0d0f', '#ffd54f')
  }
  TEX.grass.repeat.set(1, 1)
  TEX.asphalt.repeat.set(1, 1)
  return TEX
}

export class World {
  constructor (track, quality, renderer, scene) {
    this.track = track
    this.quality = quality
    this.renderer = renderer
    this.scene = scene
    this.group = new THREE.Group()
    this.rng = mulberry32(track.seed * 7919 + 17)
    this.animated = []
    this.tex = textures()
    this.ponds = []
    this.disposables = []

    this.buildGrid()
    this.buildSky()
    this.buildTerrain()
    this.buildTrack()
    this.buildBarriers()
    this.buildStartArea()
    this.buildVegetation()
    this.buildRocksAndBushes()
    this.buildPonds()
    this.buildFlags()
    this.buildClouds()
    this.buildBalloons()
    this.buildWindmill()
    scene.add(this.group)
  }

  // ---------- height field ----------
  terrainBase (x, z) {
    const t = this.track
    const s = t.seed
    let h = 12 * fbm(x * 0.006, z * 0.006, 4, s) + 3 * fbm(x * 0.03 + 7, z * 0.03, 2, s + 3)
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    const hw = (t.maxX - t.minX) / 2 + 120
    const hh = (t.maxZ - t.minZ) / 2 + 120
    const rn = Math.sqrt(((x - cx) / hw) ** 2 + ((z - cz) / hh) ** 2)
    const rise = smooth01((rn - 1.45) / 2.4)
    h += rise * 170 * (0.55 + 0.45 * fbm(x * 0.0025, z * 0.0025, 3, s + 5))
    return h
  }

  buildGrid () {
    const t = this.track
    this.x0 = t.minX - MARGIN
    this.z0 = t.minZ - MARGIN
    this.cols = Math.ceil((t.maxX - t.minX + MARGIN * 2) / CELL) + 1
    this.rows = Math.ceil((t.maxZ - t.minZ + MARGIN * 2) / CELL) + 1
    const N = this.cols * this.rows
    const dist = new Float32Array(N).fill(1e9)
    const sIdx = new Int32Array(N).fill(-1)
    const R = Math.ceil((HALF_W + BLEND_W + 6) / CELL)
    const pts = t.pts
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const gx = Math.round((p.x - this.x0) / CELL)
      const gz = Math.round((p.z - this.z0) / CELL)
      for (let dz = -R; dz <= R; dz++) {
        const cz = gz + dz
        if (cz < 0 || cz >= this.rows) continue
        for (let dx = -R; dx <= R; dx++) {
          const cx = gx + dx
          if (cx < 0 || cx >= this.cols) continue
          const wx = this.x0 + cx * CELL
          const wz = this.z0 + cz * CELL
          const d = Math.hypot(wx - p.x, wz - p.z)
          const k = cz * this.cols + cx
          if (d < dist[k]) {
            dist[k] = d
            sIdx[k] = i
          }
        }
      }
    }
    this.dist = dist
    this.sIdx = sIdx
    const h = new Float32Array(N)
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const k = cz * this.cols + cx
        const wx = this.x0 + cx * CELL
        const wz = this.z0 + cz * CELL
        const terr = this.terrainBase(wx, wz)
        const d = dist[k]
        let v = terr
        if (sIdx[k] >= 0) {
          const th = t.elev(pts[sIdx[k]].s)
          const w = smooth01((d - (HALF_W + SHOULDER + 1)) / BLEND_W)
          v = lerp(th, terr, w)
          if (d < HALF_W + SHOULDER + 3) v -= (VERGE_DROP + 0.05) * (1 - smooth01((d - (HALF_W + SHOULDER)) / 3))
        }
        h[k] = v
      }
    }
    this.h = h
    this.placePonds()
  }

  placePonds () {
    const t = this.track
    const rng = mulberry32(t.seed * 31 + 5)
    const tries = 600
    for (let i = 0; i < tries && this.ponds.length < 3; i++) {
      const r = 14 + rng() * 14
      const x = t.minX - 40 + rng() * (t.maxX - t.minX + 80)
      const z = t.minZ - 40 + rng() * (t.maxZ - t.minZ + 80)
      if (this.trackDist(x, z) < WALL_DIST + 26 + r) continue
      if (this.ponds.some(p => Math.hypot(p.x - x, p.z - z) < p.r + r + 30)) continue
      // gentle terrain only
      const h0 = this.gridH(x, z)
      let ok = true
      for (let a = 0; a < 6; a++) {
        const hx = this.gridH(x + Math.cos(a) * r, z + Math.sin(a) * r)
        if (Math.abs(hx - h0) > r * 0.22) ok = false
      }
      if (!ok) continue
      const grid = this.gridIndexBounds(x, z, r * 1.7)
      let ring = 0
      for (let a = 0; a < 8; a++) ring += this.gridH(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r)
      const wl = ring / 8 - 0.6
      for (let cz = grid.z1; cz <= grid.z2; cz++) {
        for (let cx = grid.x1; cx <= grid.x2; cx++) {
          const wx = this.x0 + cx * CELL
          const wz = this.z0 + cz * CELL
          const d = Math.hypot(wx - x, wz - z)
          if (d > r * 1.7) continue
          const k = cz * this.cols + cx
          const pondH = d < r ? wl + 0.45 - 3.4 * (1 - (d / r) ** 3) : wl + 0.45
          const w = smooth01((d - r) / (r * 0.7))
          this.h[k] = lerp(pondH, this.h[k], w)
        }
      }
      this.ponds.push({ x, z, r, wl })
    }
  }

  gridIndexBounds (x, z, rad) {
    return {
      x1: Math.max(0, Math.floor((x - rad - this.x0) / CELL)),
      x2: Math.min(this.cols - 1, Math.ceil((x + rad - this.x0) / CELL)),
      z1: Math.max(0, Math.floor((z - rad - this.z0) / CELL)),
      z2: Math.min(this.rows - 1, Math.ceil((z + rad - this.z0) / CELL))
    }
  }

  inGrid (x, z) {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + (this.cols - 1) * CELL && z <= this.z0 + (this.rows - 1) * CELL
  }

  gridH (x, z) {
    if (!this.inGrid(x, z)) return this.terrainBase(x, z)
    const gx = (x - this.x0) / CELL
    const gz = (z - this.z0) / CELL
    const ix = Math.min(this.cols - 2, Math.floor(gx))
    const iz = Math.min(this.rows - 2, Math.floor(gz))
    const fx = gx - ix
    const fz = gz - iz
    const h = this.h
    const c = this.cols
    const a = h[iz * c + ix]
    const b = h[iz * c + ix + 1]
    const d = h[(iz + 1) * c + ix]
    const e = h[(iz + 1) * c + ix + 1]
    return a + (b - a) * fx + (d - a) * fz + (a - b - d + e) * fx * fz
  }

  groundHeight (x, z) {
    return this.gridH(x, z)
  }

  trackDist (x, z) {
    if (!this.inGrid(x, z)) return 1e9
    const ix = Math.round((x - this.x0) / CELL)
    const iz = Math.round((z - this.z0) / CELL)
    return this.dist[iz * this.cols + ix]
  }

  // Height the car sits at, using exact track elevation on the asphalt.
  carHeight (x, z, n) {
    const t = this.track
    if (n && n.dist < HALF_W + SHOULDER) {
      const e = t.elev(n.s)
      if (n.dist < HALF_W) return e + TRACK_LIFT
      return lerp(e + TRACK_LIFT, e - VERGE_DROP, (n.dist - HALF_W) / SHOULDER)
    }
    return this.gridH(x, z)
  }

  groundNormal (x, z, n, out) {
    const e = 0.9
    const hl = this.carHeight(x - e, z, n && { ...n, dist: n.dist })
    const hr = this.carHeight(x + e, z, n)
    const hb = this.carHeight(x, z - e, n)
    const hf = this.carHeight(x, z + e, n)
    out.set(-(hr - hl) / (2 * e), 1, -(hf - hb) / (2 * e)).normalize()
    return out
  }

  isNearPond (x, z, pad = 0) {
    return this.ponds.some(p => Math.hypot(p.x - x, p.z - z) < p.r * 1.25 + pad)
  }

  // ---------- sky / lighting ----------
  buildSky () {
    const sky = new Sky()
    sky.scale.setScalar(FAR * 2)
    const u = sky.material.uniforms
    u.turbidity.value = 3
    u.rayleigh.value = 1.3
    u.mieCoefficient.value = 0.006
    u.mieDirectionalG.value = 0.84
    const elev = THREE.MathUtils.degToRad(32)
    const az = THREE.MathUtils.degToRad(140)
    const sun = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az)
    u.sunPosition.value.copy(sun)
    this.sunDir = sun.clone()
    this.group.add(sky)
    this.sky = sky

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const envScene = new THREE.Scene()
    const sky2 = new Sky()
    sky2.scale.setScalar(FAR * 2)
    sky2.material.uniforms.turbidity.value = 3
    sky2.material.uniforms.rayleigh.value = 1.3
    sky2.material.uniforms.mieCoefficient.value = 0.006
    sky2.material.uniforms.mieDirectionalG.value = 0.84
    sky2.material.uniforms.sunPosition.value.copy(sun)
    envScene.add(sky2)
    // A dark ground so PBR reflections show a horizon.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(FAR * 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3b4a2c }))
    ground.position.y = -2
    envScene.add(ground)
    const env = pmrem.fromScene(envScene, 0.02)
    this.scene.environment = env.texture
    this.scene.environmentIntensity = 0.4
    this.envTex = env.texture
    pmrem.dispose()
    sky2.material.dispose()
    sky2.geometry.dispose()
    ground.geometry.dispose()
    ground.material.dispose()

    this.scene.fog = new THREE.Fog(0xbfcfe0, 450, 3000)
  }

  // ---------- terrain ----------
  terrainColor (x, z, h, slope, out) {
    const s = this.track.seed
    const n = fbm(x * 0.02, z * 0.02, 3, s + 9)
    const n2 = fbm(x * 0.09, z * 0.09, 2, s + 12)
    // grass base with patches
    let r = 0.30 + n * 0.08 + n2 * 0.04
    let g = 0.50 + n * 0.10 + n2 * 0.05
    let b = 0.16 + n * 0.04
    // dry yellowish patches
    const dry = smooth01((fbm(x * 0.012 + 3, z * 0.012, 2, s + 20) - 0.15) / 0.35)
    r = lerp(r, 0.55, dry * 0.5)
    g = lerp(g, 0.52, dry * 0.5)
    b = lerp(b, 0.22, dry * 0.5)
    // rock on steep slopes
    const rock = smooth01((slope - 0.55) / 0.35)
    r = lerp(r, 0.42 + n2 * 0.05, rock)
    g = lerp(g, 0.40 + n2 * 0.05, rock)
    b = lerp(b, 0.37 + n2 * 0.04, rock)
    // snow on the high peaks
    const snow = smooth01((h - 95 - n * 15) / 25)
    r = lerp(r, 0.92, snow)
    g = lerp(g, 0.94, snow)
    b = lerp(b, 0.97, snow)
    // sand near ponds
    for (const p of this.ponds) {
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < p.r * 1.3) {
        const sand = smooth01((p.r * 1.15 - d) / (p.r * 0.25)) * smooth01((p.wl + 1.2 - h) / 0.8)
        r = lerp(r, 0.72, sand)
        g = lerp(g, 0.66, sand)
        b = lerp(b, 0.48, sand)
      }
    }
    // dirt verge next to the track
    const td = this.trackDist(x, z)
    const verge = smooth01((HALF_W + SHOULDER + 4 - td) / 3)
    r = lerp(r, 0.36, verge * 0.7)
    g = lerp(g, 0.30, verge * 0.7)
    b = lerp(b, 0.18, verge * 0.7)
    out.setRGB(r, g, b, THREE.SRGBColorSpace)
    return out
  }

  buildTerrain () {
    const tex = this.tex
    const c = new THREE.Color()
    // Inner detailed mesh with a dropped skirt ring to hide the seam.
    const cols = this.cols
    const rows = this.rows
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(cols * rows * 3)
    const col = new Float32Array(cols * rows * 3)
    const uv = new Float32Array(cols * rows * 2)
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const k = iz * cols + ix
        const x = this.x0 + ix * CELL
        const z = this.z0 + iz * CELL
        let h = this.h[k]
        const edge = ix === 0 || iz === 0 || ix === cols - 1 || iz === rows - 1
        const hx = (this.h[iz * cols + Math.min(cols - 1, ix + 1)] - this.h[iz * cols + Math.max(0, ix - 1)]) / (2 * CELL)
        const hz = (this.h[Math.min(rows - 1, iz + 1) * cols + ix] - this.h[Math.max(0, iz - 1) * cols + ix]) / (2 * CELL)
        const slope = Math.hypot(hx, hz)
        this.terrainColor(x, z, h, slope, c)
        if (edge) h -= 25
        pos[k * 3] = x
        pos[k * 3 + 1] = h
        pos[k * 3 + 2] = z
        col[k * 3] = c.r
        col[k * 3 + 1] = c.g
        col[k * 3 + 2] = c.b
        uv[k * 2] = x / 7
        uv[k * 2 + 1] = z / 7
      }
    }
    const idx = []
    for (let iz = 0; iz < rows - 1; iz++) {
      for (let ix = 0; ix < cols - 1; ix++) {
        const a = iz * cols + ix
        const b = a + 1
        const d = a + cols
        const e = d + 1
        idx.push(a, d, b, b, d, e)
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.grass, roughness: 0.96, metalness: 0 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.castShadow = false
    this.group.add(mesh)
    this.disposables.push(geo, mat)

    // Outer coarse mesh for the far hills and mountains.
    const N = 150
    const ogeo = new THREE.BufferGeometry()
    const opos = new Float32Array((N + 1) * (N + 1) * 3)
    const ocol = new Float32Array((N + 1) * (N + 1) * 3)
    const ouv = new Float32Array((N + 1) * (N + 1) * 2)
    const cx = (this.track.minX + this.track.maxX) / 2
    const cz = (this.track.minZ + this.track.maxZ) / 2
    const inX1 = this.x0 + 10
    const inX2 = this.x0 + (this.cols - 1) * CELL - 10
    const inZ1 = this.z0 + 10
    const inZ2 = this.z0 + (this.rows - 1) * CELL - 10
    // Lowest point of the detailed heightfield (track carving and ponds
    // included). The coarse mesh samples terrainBase, which near the road
    // can sit well above the carved heightfield, so a fixed offset is not
    // enough to keep it hidden.
    let minH = Infinity
    for (const v of this.h) if (v < minH) minH = v
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        const k = iz * (N + 1) + ix
        const x = cx + (ix / N - 0.5) * FAR * 2
        const z = cz + (iz / N - 0.5) * FAR * 2
        let h = this.terrainBase(x, z)
        // Tuck the coarse mesh under the detailed one where they overlap:
        // drop it below the lowest detailed vertex so it never rises
        // through the road.
        const inside = x > inX1 && x < inX2 && z > inZ1 && z < inZ2
        if (inside) h = Math.min(h, minH) - 8
        const e = 12
        const hx = (this.terrainBase(x + e, z) - this.terrainBase(x - e, z)) / (2 * e)
        const hz = (this.terrainBase(x, z + e) - this.terrainBase(x, z - e)) / (2 * e)
        this.terrainColor(x, z, h, Math.hypot(hx, hz), c)
        opos[k * 3] = x
        opos[k * 3 + 1] = h
        opos[k * 3 + 2] = z
        ocol[k * 3] = c.r
        ocol[k * 3 + 1] = c.g
        ocol[k * 3 + 2] = c.b
        ouv[k * 2] = x / 7
        ouv[k * 2 + 1] = z / 7
      }
    }
    const oidx = []
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * (N + 1) + ix
        const b = a + 1
        const d = a + N + 1
        const e = d + 1
        oidx.push(a, d, b, b, d, e)
      }
    }
    ogeo.setAttribute('position', new THREE.BufferAttribute(opos, 3))
    ogeo.setAttribute('color', new THREE.BufferAttribute(ocol, 3))
    ogeo.setAttribute('uv', new THREE.BufferAttribute(ouv, 2))
    ogeo.setIndex(oidx)
    ogeo.computeVertexNormals()
    const omesh = new THREE.Mesh(ogeo, mat)
    omesh.receiveShadow = true
    this.group.add(omesh)
    this.disposables.push(ogeo)
  }

  // ---------- track ----------
  ribbon (offA, offB, yA, yB, uvScale, filter) {
    // Builds a quad strip between lateral offsets offA/offB (metres, signed)
    // along the whole lap. yA/yB are functions (i, elev) -> y. The first row is
    // duplicated at the end so UVs don't wrap backwards on the closing quad.
    const pts = this.track.pts
    const m = pts.length
    const rows = m + 1
    const pos = new Float32Array(rows * 2 * 3)
    const uv = new Float32Array(rows * 2 * 2)
    for (let r = 0; r < rows; r++) {
      const i = r % m
      const p = pts[i]
      const e = this.track.elev(p.s)
      const nx = -p.tz
      const nz = p.tx
      const v = (r === m ? this.track.len : p.s) / uvScale
      pos[r * 6] = p.x + nx * offA
      pos[r * 6 + 1] = yA(i, e)
      pos[r * 6 + 2] = p.z + nz * offA
      pos[r * 6 + 3] = p.x + nx * offB
      pos[r * 6 + 4] = yB(i, e)
      pos[r * 6 + 5] = p.z + nz * offB
      uv[r * 4] = 0
      uv[r * 4 + 1] = v
      uv[r * 4 + 2] = 1
      uv[r * 4 + 3] = v
    }
    const idx = []
    const flip = offB > offA // keep the face normal pointing up
    for (let i = 0; i < m; i++) {
      if (filter && !filter(i)) continue
      const a = i * 2
      const b = i * 2 + 1
      const c = (i + 1) * 2
      const d = (i + 1) * 2 + 1
      if (flip) idx.push(a, b, c, b, d, c)
      else idx.push(a, c, b, b, c, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    this.disposables.push(geo)
    return geo
  }

  buildTrack () {
    const tex = this.tex
    const t = this.track
    const pts = t.pts
    const m = pts.length
    // Asphalt (uv.x across, uv.y along, 10 m per tile)
    const asph = this.ribbon(-HALF_W, HALF_W, (i, e) => e + TRACK_LIFT, (i, e) => e + TRACK_LIFT, 10)
    const amat = new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.82, metalness: 0.02 })
    const amesh = new THREE.Mesh(asph, amat)
    amesh.receiveShadow = true
    this.group.add(amesh)
    this.disposables.push(amat)

    // Curb classification: corners (|curvature| above a threshold, dilated)
    const isCurb = new Uint8Array(m)
    for (let i = 0; i < m; i++) {
      for (let k = -10; k <= 10; k++) {
        if (Math.abs(pts[((i + k) % m + m) % m].k) > 0.012) {
          isCurb[i] = 1
          break
        }
      }
    }
    const curbMat = new THREE.MeshStandardMaterial({ map: tex.curb, roughness: 0.7 })
    const verMat = new THREE.MeshStandardMaterial({ map: tex.gravel, roughness: 1 })
    this.disposables.push(curbMat, verMat)
    for (const side of [-1, 1]) {
      const inner = side * HALF_W
      const outer = side * (HALF_W + SHOULDER)
      const yIn = (i, e) => e + TRACK_LIFT
      const yOut = (i, e) => e - VERGE_DROP
      const cg = this.ribbon(inner, outer, yIn, yOut, 2, i => isCurb[i] && isCurb[(i + 1) % m])
      const vg = this.ribbon(inner, outer, yIn, yOut, 6, i => !(isCurb[i] && isCurb[(i + 1) % m]))
      const cm = new THREE.Mesh(cg, curbMat)
      const vm = new THREE.Mesh(vg, verMat)
      cm.receiveShadow = vm.receiveShadow = true
      this.group.add(cm, vm)
    }

    // Start / finish line
    const p0 = pts[0]
    const line = new THREE.Mesh(new THREE.PlaneGeometry(3, HALF_W * 2, 1, 1), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }))
    line.rotation.x = -Math.PI / 2
    line.rotation.z = -Math.atan2(p0.tz, p0.tx)
    line.position.set(p0.x, t.elev(0) + TRACK_LIFT + 0.02, p0.z)
    line.receiveShadow = true
    this.group.add(line)
    this.disposables.push(line.geometry, line.material)
  }

  buildBarriers () {
    const tex = this.tex
    const t = this.track
    const pts = t.pts
    const metal = new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide })
    this.disposables.push(metal)
    const postGeo = new THREE.BoxGeometry(0.14, 1.15, 0.14)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.5, metalness: 0.7 })
    this.disposables.push(postGeo, postMat)
    const count = Math.ceil(t.len / 4) * 2
    const posts = new THREE.InstancedMesh(postGeo, postMat, count)
    posts.castShadow = true
    posts.receiveShadow = true
    let pi = 0
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3(1, 1, 1)
    for (const side of [-1, 1]) {
      const off = side * WALL_DIST
      const g = this.ribbon(off, off, (i, e) => this.gridH(pts[i].x - pts[i].tz * off, pts[i].z + pts[i].tx * off) + 0.28,
        (i, e) => this.gridH(pts[i].x - pts[i].tz * off, pts[i].z + pts[i].tx * off) + 1.0, 4)
      // uv.x is 0/1 across → v direction stacks corrugation; swap so bands run horizontally
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i)
        const v = uv.getY(i)
        uv.setXY(i, v, u)
      }
      const mesh = new THREE.Mesh(g, metal)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      for (let s = 0; s < t.len; s += 4) {
        const p = t.poseAt(s)
        const x = p.x - p.tz * (off + side * 0.12)
        const z = p.z + p.tx * (off + side * 0.12)
        const y = this.gridH(x, z)
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.a)
        M.compose(new THREE.Vector3(x, y + 0.55, z), Q, S)
        posts.setMatrixAt(pi++, M)
      }
    }
    posts.count = pi
    posts.instanceMatrix.needsUpdate = true
    this.group.add(posts)

    // Tyre stacks on the outside of sharp corners
    const tyreGeo = new THREE.TorusGeometry(0.45, 0.2, 8, 14)
    tyreGeo.rotateX(Math.PI / 2)
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 })
    this.disposables.push(tyreGeo, tyreMat)
    const stacks = []
    let lastS = -1e9
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (Math.abs(p.k) > 0.022 && p.s - lastS > 9) {
        lastS = p.s
        const side = p.k > 0 ? -1 : 1 // outside of the bend
        for (let j = -1; j <= 1; j++) {
          const sp = t.poseAt(p.s + j * 1.1)
          stacks.push({ x: sp.x - sp.tz * side * (WALL_DIST + 1.4), z: sp.z + sp.tx * side * (WALL_DIST + 1.4) })
        }
      }
    }
    if (stacks.length) {
      const tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, stacks.length * 3)
      tyres.castShadow = true
      tyres.receiveShadow = true
      let ti = 0
      const rng = this.rng
      for (const st of stacks) {
        const y = this.gridH(st.x, st.z)
        for (let l = 0; l < 3; l++) {
          Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3)
          M.compose(new THREE.Vector3(st.x, y + 0.2 + l * 0.4, st.z), Q, S)
          tyres.setMatrixAt(ti++, M)
        }
      }
      tyres.instanceMatrix.needsUpdate = true
      this.group.add(tyres)
    }
  }

  buildStartArea () {
    const tex = this.tex
    const t = this.track
    const p0 = t.poseAt(0)
    const y0 = t.elev(0)
    const conc = new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9 })
    this.disposables.push(conc)
    const span = WALL_DIST + 1.6
    const gantry = new THREE.Group()
    gantry.position.set(p0.x, y0, p0.z)
    gantry.rotation.y = -p0.a
    const pillarGeo = new THREE.BoxGeometry(0.7, 7, 0.7)
    this.disposables.push(pillarGeo)
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, conc)
      pillar.position.set(0, 3.5, side * span)
      pillar.castShadow = pillar.receiveShadow = true
      gantry.add(pillar)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, span * 2 + 0.7), conc)
    beam.position.y = 6.55
    beam.castShadow = true
    gantry.add(beam)
    this.disposables.push(beam.geometry)
    const bannerMat = new THREE.MeshStandardMaterial({ map: tex.banner, roughness: 0.8, emissive: 0x222222, emissiveMap: tex.banner, emissiveIntensity: 0.6 })
    const bannerGeo = new THREE.PlaneGeometry(span * 2 - 0.4, 1.7)
    for (const dir of [1, -1]) {
      const banner = new THREE.Mesh(bannerGeo, bannerMat)
      banner.position.set(dir * 0.02, 5.2, 0)
      banner.rotation.y = dir * Math.PI / 2
      banner.castShadow = true
      gantry.add(banner)
    }
    this.disposables.push(bannerGeo, bannerMat)
    // Lights on the gantry
    const lightGeo = new THREE.SphereGeometry(0.22, 10, 8)
    const lightMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2200, emissiveIntensity: 2.5 })
    this.disposables.push(lightGeo, lightMat)
    this.startLights = []
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(lightGeo, lightMat.clone())
      l.position.set(0.7, 6.0, (i - 2) * 1.4)
      l.material.emissiveIntensity = 0
      gantry.add(l)
      this.startLights.push(l)
    }
    this.group.add(gantry)

    // Grandstand on the outer side of the start straight
    const pts = t.pts
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length
    const nx = -p0.tz
    const nz = p0.tx
    const innerSide = Math.sign(nx * (cx - p0.x) + nz * (cz - p0.z)) || 1
    const side = -innerSide
    this.standSide = side
    const sA = t.len - 78
    const sB = t.len - 6
    const iA = t.at(sA).idx
    const iB = t.at(sB).idx
    const range = []
    for (let i = iA; i !== iB; i = (i + 1) % pts.length) range.push(i)
    range.push(iB)
    const tiers = 6
    const depth = 2.2
    const rise = 1.0
    const base0 = WALL_DIST + 4
    const pos = []
    const idx = []
    const uv = []
    const push = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1 }
    // Ground level under the stand so it sits on a level plinth
    let plinth = Infinity
    for (const i of range) {
      const p = pts[i]
      for (let k = 0; k <= tiers; k++) {
        const off = side * (base0 + k * depth)
        plinth = Math.min(plinth, this.gridH(p.x - p.tz * off, p.z + p.tx * off))
      }
    }
    const rows = []
    for (const i of range) {
      const p = pts[i]
      const row = []
      for (let k = 0; k <= tiers; k++) {
        const off = side * (base0 + k * depth)
        const x = p.x - p.tz * off
        const z = p.z + p.tx * off
        const yTop = plinth + 0.5 + k * rise
        const yLow = plinth + 0.5 + Math.max(0, k - 1) * rise
        row.push({ x, z, yTop, yLow, s: p.s })
      }
      rows.push(row)
    }
    // Front face + tier treads/risers
    for (let r = 0; r < rows.length - 1; r++) {
      const A = rows[r]
      const B = rows[r + 1]
      for (let k = 0; k < tiers; k++) {
        // tread from k to k+1 at height yTop of k
        const a = push(A[k].x, A[k].yTop, A[k].z, A[k].s / 4, 0)
        const b = push(A[k + 1].x, A[k].yTop, A[k + 1].z, A[k].s / 4, 1)
        const c = push(B[k].x, B[k].yTop, B[k].z, B[k].s / 4, 0)
        const d = push(B[k + 1].x, B[k].yTop, B[k + 1].z, B[k].s / 4, 1)
        idx.push(a, b, c, b, d, c)
        // riser at k+1 from yTop(k) to yTop(k+1)
        const e = push(A[k + 1].x, A[k].yTop, A[k + 1].z, A[k].s / 4, 0)
        const f = push(A[k + 1].x, A[k + 1].yTop, A[k + 1].z, A[k].s / 4, 0.4)
        const g = push(B[k + 1].x, B[k].yTop, B[k + 1].z, B[k].s / 4, 0)
        const h = push(B[k + 1].x, B[k + 1].yTop, B[k + 1].z, B[k].s / 4, 0.4)
        idx.push(e, f, g, f, h, g)
      }
      // front wall from ground to first tread
      const gA = this.gridH(A[0].x, A[0].z) - 1
      const gB = this.gridH(B[0].x, B[0].z) - 1
      const a = push(A[0].x, gA, A[0].z, A[0].s / 4, 0)
      const b = push(A[0].x, A[0].yTop, A[0].z, A[0].s / 4, 0.5)
      const c = push(B[0].x, gB, B[0].z, B[0].s / 4, 0)
      const d = push(B[0].x, B[0].yTop, B[0].z, B[0].s / 4, 0.5)
      idx.push(a, b, c, b, d, c)
      // back wall
      const K = tiers
      const gA2 = this.gridH(A[K].x, A[K].z) - 1
      const gB2 = this.gridH(B[K].x, B[K].z) - 1
      const a2 = push(A[K].x, gA2, A[K].z, A[K].s / 4, 0)
      const b2 = push(A[K].x, A[K].yTop, A[K].z, A[K].s / 4, 1)
      const c2 = push(B[K].x, gB2, B[K].z, B[K].s / 4, 0)
      const d2 = push(B[K].x, B[K].yTop, B[K].z, B[K].s / 4, 1)
      idx.push(a2, b2, c2, b2, d2, c2)
    }
    const sgeo = new THREE.BufferGeometry()
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    sgeo.setIndex(idx)
    sgeo.computeVertexNormals()
    const smat = new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9, side: THREE.DoubleSide })
    const stand = new THREE.Mesh(sgeo, smat)
    stand.castShadow = stand.receiveShadow = true
    this.group.add(stand)
    this.disposables.push(sgeo, smat)
    this.standCenter = { x: rows[Math.floor(rows.length / 2)][3].x, z: rows[Math.floor(rows.length / 2)][3].z }

    // Crowd: colourful blocks on the tiers
    const crowdGeo = new THREE.BoxGeometry(0.45, 0.75, 0.45)
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.85 })
    this.disposables.push(crowdGeo, crowdMat)
    const crowdN = Math.min(900, rows.length * tiers)
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdN)
    crowd.castShadow = true
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3(1, 1, 1)
    const col = new THREE.Color()
    let ci = 0
    const rng = this.rng
    for (let r = 0; r < rows.length && ci < crowdN; r += 1) {
      for (let k = 0; k < tiers && ci < crowdN; k++) {
        if (rng() < 0.35) continue
        const A = rows[r][k]
        const B = rows[r][k + 1]
        const f = 0.55
        const x = A.x + (B.x - A.x) * f
        const z = A.z + (B.z - A.z) * f
        M.compose(new THREE.Vector3(x, A.yTop + 0.38, z), Q, S)
        crowd.setMatrixAt(ci, M)
        col.setHSL(rng(), 0.75, 0.55)
        crowd.setColorAt(ci, col)
        ci++
      }
    }
    crowd.count = ci
    crowd.instanceMatrix.needsUpdate = true
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true
    this.group.add(crowd)
    // Roof over the stand
    const roofGeo = new THREE.BoxGeometry(1, 0.25, 1)
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xd84315, roughness: 0.6, metalness: 0.3 })
    this.disposables.push(roofGeo, roofMat)
  }

  // ---------- vegetation ----------
  treeGeometries () {
    const c = new THREE.Color()
    const colorize = (g0, hex) => {
      const g = g0.index ? g0.toNonIndexed() : g0
      if (g !== g0) g0.dispose()
      c.set(hex)
      const n = g.attributes.position.count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      return g
    }
    const pine = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.16, 0.3, 3.4, 7).translate(0, 1.7, 0), 0x5b3d26),
      colorize(new THREE.ConeGeometry(2.3, 3.6, 9).translate(0, 4.2, 0), 0x2f6b34),
      colorize(new THREE.ConeGeometry(1.8, 3.2, 9).translate(0, 6.2, 0), 0x357a3b),
      colorize(new THREE.ConeGeometry(1.15, 2.6, 9).translate(0, 8.0, 0), 0x3f8a43)
    ])
    const broad = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.22, 0.4, 3.8, 7).translate(0, 1.9, 0), 0x6b4a2e),
      colorize(new THREE.IcosahedronGeometry(2.4, 1).translate(0, 5.0, 0), 0x4c8a2f),
      colorize(new THREE.IcosahedronGeometry(1.9, 1).translate(1.4, 4.2, 0.6), 0x55973a),
      colorize(new THREE.IcosahedronGeometry(1.8, 1).translate(-1.3, 4.4, -0.8), 0x3f7a2a),
      colorize(new THREE.IcosahedronGeometry(1.5, 1).translate(0.2, 6.5, 0.3), 0x5ea340)
    ])
    const birch = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.12, 0.2, 5.0, 6).translate(0, 2.5, 0), 0xd8d4c8),
      colorize(new THREE.IcosahedronGeometry(1.6, 1).translate(0, 5.6, 0), 0x8fbf3c),
      colorize(new THREE.IcosahedronGeometry(1.2, 1).translate(0.9, 4.6, 0.5), 0xa1c94a)
    ])
    this.disposables.push(pine, broad, birch)
    return { pine, broad, birch }
  }

  buildVegetation () {
    const q = this.quality
    const geos = this.treeGeometries()
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
    this.disposables.push(mat)
    const t = this.track
    const rng = this.rng
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3()
    const col = new THREE.Color()
    const yAxis = new THREE.Vector3(0, 1, 0)
    const placedNear = []
    const hash = new Map()
    const cellOf = (x, z) => (Math.floor(x / 6) * 73856093) ^ (Math.floor(z / 6) * 19349663)
    const tooClose = (x, z, min) => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = hash.get(cellOf(x + dx * 6, z + dz * 6))
          if (!list) continue
          for (const p of list) if (Math.hypot(p.x - x, p.z - z) < min) return true
        }
      }
      return false
    }
    const remember = (x, z) => {
      const k = cellOf(x, z)
      if (!hash.has(k)) hash.set(k, [])
      hash.get(k).push({ x, z })
    }
    const nearOK = (x, z) => {
      const d = this.trackDist(x, z)
      if (d < WALL_DIST + 5) return false
      if (this.isNearPond(x, z, 2)) return false
      if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 45) return false
      const h = this.gridH(x, z)
      const sl = Math.hypot(this.gridH(x + 1, z) - this.gridH(x - 1, z), this.gridH(x, z + 1) - this.gridH(x, z - 1)) / 2
      if (sl > 0.75) return false
      if (h > 95) return false
      return true
    }
    // Forest density rises with distance from the track.
    const near = []
    const NEAR_N = q.trees
    let attempts = 0
    while (near.length < NEAR_N && attempts < NEAR_N * 12) {
      attempts++
      const x = this.x0 + 8 + rng() * ((this.cols - 1) * CELL - 16)
      const z = this.z0 + 8 + rng() * ((this.rows - 1) * CELL - 16)
      const d = this.trackDist(x, z)
      const density = d < WALL_DIST + 30 ? 0.35 : d < WALL_DIST + 80 ? 0.7 : 1
      if (rng() > density) continue
      if (!nearOK(x, z)) continue
      if (tooClose(x, z, 4.6)) continue
      remember(x, z)
      near.push({ x, z })
    }
    // Far ring trees on the outer mesh.
    const far = []
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    for (let i = 0; i < q.farTrees; i++) {
      const x = cx + (rng() * 2 - 1) * 1300
      const z = cz + (rng() * 2 - 1) * 1300
      if (this.inGrid(x, z)) continue
      const h = this.terrainBase(x, z)
      if (h > 90) continue
      far.push({ x, z })
    }
    const kinds = ['pine', 'broad', 'birch']
    const meshes = {}
    const total = near.length + far.length
    for (const k of kinds) {
      meshes[k] = new THREE.InstancedMesh(geos[k], mat, total)
      meshes[k].castShadow = true
      meshes[k].receiveShadow = true
      meshes[k].count = 0
    }
    const place = (p, farTree) => {
      const y = farTree ? this.terrainBase(p.x, p.z) : this.gridH(p.x, p.z)
      const kind = rng() < 0.5 ? 'pine' : rng() < 0.7 ? 'broad' : 'birch'
      const im = meshes[kind]
      const sc = (farTree ? 1.3 : 0.85) + rng() * 0.7
      Q.setFromAxisAngle(yAxis, rng() * Math.PI * 2)
      S.set(sc, sc * (0.9 + rng() * 0.3), sc)
      M.compose(new THREE.Vector3(p.x, y - 0.2, p.z), Q, S)
      im.setMatrixAt(im.count, M)
      col.setRGB(0.85 + rng() * 0.25, 0.85 + rng() * 0.25, 0.85 + rng() * 0.2)
      im.setColorAt(im.count, col)
      im.count++
    }
    for (const p of near) place(p, false)
    for (const p of far) place(p, true)
    for (const k of kinds) {
      meshes[k].instanceMatrix.needsUpdate = true
      if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true
      this.group.add(meshes[k])
    }

    // Grass tufts near the track (wind-animated)
    const bladeGeo = mergeGeometries([
      new THREE.PlaneGeometry(1.3, 1.0).translate(0, 0.5, 0).toNonIndexed(),
      new THREE.PlaneGeometry(1.3, 1.0).translate(0, 0.5, 0).rotateY(Math.PI / 2).toNonIndexed()
    ])
    this.disposables.push(bladeGeo)
    const bladeMat = new THREE.MeshStandardMaterial({ map: this.tex.blade, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: 0x86b453 })
    this.windUniform = { value: 0 }
    const wind = this.windUniform
    bladeMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = wind
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float wph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;\n transformed.x += sin(uTime * 1.7 + wph) * 0.14 * uv.y;\n transformed.z += cos(uTime * 1.3 + wph * 1.3) * 0.08 * uv.y;')
    }
    this.disposables.push(bladeMat)
    const G = q.grass
    const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, G)
    grass.receiveShadow = true
    let gi = 0
    let ga = 0
    while (gi < G && ga < G * 8) {
      ga++
      const s = rng() * t.len
      const side = rng() < 0.5 ? -1 : 1
      const off = side * (WALL_DIST + 1.5 + Math.pow(rng(), 1.6) * 55)
      const p = t.poseAt(s)
      const x = p.x - p.tz * off + (rng() - 0.5) * 3
      const z = p.z + p.tx * off + (rng() - 0.5) * 3
      if (!this.inGrid(x, z) || this.isNearPond(x, z, -2)) continue
      if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 40 && Math.abs(off) < WALL_DIST + 20) continue
      const y = this.gridH(x, z)
      const sc = 0.7 + rng() * 0.9
      Q.setFromAxisAngle(yAxis, rng() * Math.PI)
      S.set(sc, sc, sc)
      M.compose(new THREE.Vector3(x, y - 0.05, z), Q, S)
      grass.setMatrixAt(gi, M)
      gi++
    }
    grass.count = gi
    grass.userData.noAO = true
    grass.instanceMatrix.needsUpdate = true
    this.group.add(grass)
  }

  buildRocksAndBushes () {
    const rng = this.rng
    const t = this.track
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3()
    const E = new THREE.Euler()
    const rockGeo = new THREE.DodecahedronGeometry(1, 1)
    const rp = rockGeo.attributes.position
    for (let i = 0; i < rp.count; i++) {
      const k = 0.75 + fbm(rp.getX(i) * 2, rp.getZ(i) * 2 + rp.getY(i), 2, 3) * 0.4
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.7, rp.getZ(i) * k)
    }
    rockGeo.computeVertexNormals()
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8781, roughness: 0.95, flatShading: true })
    this.disposables.push(rockGeo, rockMat)
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 260)
    rocks.castShadow = rocks.receiveShadow = true
    let ri = 0
    let att = 0
    while (ri < 260 && att < 4000) {
      att++
      const x = this.x0 + 8 + rng() * ((this.cols - 1) * CELL - 16)
      const z = this.z0 + 8 + rng() * ((this.rows - 1) * CELL - 16)
      if (this.trackDist(x, z) < WALL_DIST + 3) continue
      if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 40) continue
      const nearPond = this.ponds.some(p => Math.hypot(p.x - x, p.z - z) < p.r * 1.25 && Math.hypot(p.x - x, p.z - z) > p.r * 0.98)
      if (this.isNearPond(x, z, 0) && !nearPond) continue
      const y = this.gridH(x, z)
      const sc = nearPond ? 0.4 + rng() * 0.6 : 0.5 + rng() * 2.4
      E.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5)
      Q.setFromEuler(E)
      S.set(sc * (0.8 + rng() * 0.5), sc * (0.6 + rng() * 0.5), sc)
      M.compose(new THREE.Vector3(x, y - sc * 0.25, z), Q, S)
      rocks.setMatrixAt(ri++, M)
    }
    rocks.count = ri
    rocks.instanceMatrix.needsUpdate = true
    this.group.add(rocks)

    const bushGeo = new THREE.IcosahedronGeometry(1, 1)
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3f8a33, roughness: 0.9, flatShading: true })
    this.disposables.push(bushGeo, bushMat)
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 420)
    bushes.castShadow = bushes.receiveShadow = true
    let bi = 0
    att = 0
    const col = new THREE.Color()
    while (bi < 420 && att < 6000) {
      att++
      const s = rng() * t.len
      const side = rng() < 0.5 ? -1 : 1
      const off = side * (WALL_DIST + 2.5 + rng() * 30)
      const p = t.poseAt(s)
      const x = p.x - p.tz * off
      const z = p.z + p.tx * off
      if (!this.inGrid(x, z) || this.isNearPond(x, z, 1)) continue
      if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 42) continue
      const y = this.gridH(x, z)
      const sc = 0.6 + rng() * 1.1
      E.set(0, rng() * 6, 0)
      Q.setFromEuler(E)
      S.set(sc * 1.2, sc * 0.8, sc)
      M.compose(new THREE.Vector3(x, y + sc * 0.3, z), Q, S)
      bushes.setMatrixAt(bi, M)
      col.setHSL(0.27 + rng() * 0.08, 0.5, 0.3 + rng() * 0.15)
      bushes.setColorAt(bi, col)
      bi++
    }
    bushes.count = bi
    bushes.instanceMatrix.needsUpdate = true
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true
    this.group.add(bushes)
  }

  buildPonds () {
    const tex = this.tex
    const rng = this.rng
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1d5d78,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      normalMap: tex.waterN,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.4,
      clearcoat: 0.6,
      clearcoatRoughness: 0.05
    })
    this.disposables.push(waterMat)
    const padGeo = new THREE.CircleGeometry(0.38, 10).rotateX(-Math.PI / 2)
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3e8a35, roughness: 0.8, side: THREE.DoubleSide })
    this.disposables.push(padGeo, padMat)
    const reedGeo = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 4).translate(0, 0.8, 0)
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 1 })
    this.disposables.push(reedGeo, reedMat)
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3(1, 1, 1)
    const E = new THREE.Euler()
    for (const [pi, p] of this.ponds.entries()) {
      const geo = new THREE.CircleGeometry(p.r * 0.985, 48).rotateX(-Math.PI / 2)
      this.disposables.push(geo)
      const water = new THREE.Mesh(geo, waterMat)
      water.position.set(p.x, p.wl, p.z)
      water.receiveShadow = true
      this.group.add(water)
      // lily pads
      const pads = new THREE.InstancedMesh(padGeo, padMat, 24)
      for (let i = 0; i < 24; i++) {
        const a = rng() * Math.PI * 2
        const r = p.r * (0.2 + rng() * 0.55)
        E.set(0, rng() * 6, 0)
        Q.setFromEuler(E)
        M.compose(new THREE.Vector3(p.x + Math.cos(a) * r, p.wl + 0.03, p.z + Math.sin(a) * r), Q, S)
        pads.setMatrixAt(i, M)
      }
      pads.instanceMatrix.needsUpdate = true
      this.group.add(pads)
      // reeds
      const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 90)
      reeds.castShadow = true
      for (let i = 0; i < 90; i++) {
        const a = rng() * Math.PI * 2
        const r = p.r * (0.9 + rng() * 0.16)
        const x = p.x + Math.cos(a) * r
        const z = p.z + Math.sin(a) * r
        const y = Math.min(this.gridH(x, z), p.wl - 0.1)
        E.set((rng() - 0.5) * 0.3, rng() * 6, (rng() - 0.5) * 0.3)
        Q.setFromEuler(E)
        const sc = 0.7 + rng() * 0.8
        M.compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sc, sc, sc))
        reeds.setMatrixAt(i, M)
      }
      reeds.instanceMatrix.needsUpdate = true
      this.group.add(reeds)
      // wooden dock on the first pond
      if (pi === 0) {
        const wood = new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.85 })
        this.disposables.push(wood)
        const dock = new THREE.Group()
        const a = rng() * Math.PI * 2
        dock.position.set(p.x + Math.cos(a) * p.r * 0.95, p.wl + 0.45, p.z + Math.sin(a) * p.r * 0.95)
        dock.rotation.y = -a + Math.PI
        const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.16, 2.2), wood)
        deck.position.x = -3.2
        deck.castShadow = deck.receiveShadow = true
        dock.add(deck)
        this.disposables.push(deck.geometry)
        const postG = new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6)
        this.disposables.push(postG)
        for (const [px, pz] of [[-6.4, -0.9], [-6.4, 0.9], [-3, -0.9], [-3, 0.9], [0.2, -0.9], [0.2, 0.9]]) {
          const post = new THREE.Mesh(postG, wood)
          post.position.set(px, -0.5, pz)
          post.castShadow = true
          dock.add(post)
        }
        this.group.add(dock)
      }
    }
    this.waterMat = waterMat
  }

  buildFlags () {
    const t = this.track
    const rng = this.rng
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6).translate(0, 1.7, 0)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.6 })
    const flagGeo = new THREE.PlaneGeometry(1.1, 0.65, 6, 1).translate(0.55, 0, 0)
    const flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 })
    this.disposables.push(poleGeo, poleMat, flagGeo, flagMat)
    const wind = this.windUniform
    flagMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = wind
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float fph = instanceMatrix[3].x * 0.5 + instanceMatrix[3].z * 0.4;\n transformed.z += sin(uTime * 6.0 + uv.x * 6.0 + fph) * 0.12 * uv.x;\n transformed.y += sin(uTime * 4.0 + uv.x * 5.0 + fph) * 0.04 * uv.x;')
    }
    const n = Math.floor(t.len / 38) * 2
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, n)
    const flags = new THREE.InstancedMesh(flagGeo, flagMat, n)
    poles.castShadow = true
    const M = new THREE.Matrix4()
    const Q = new THREE.Quaternion()
    const S = new THREE.Vector3(1, 1, 1)
    const yAxis = new THREE.Vector3(0, 1, 0)
    const col = new THREE.Color()
    let i = 0
    for (let s = 19; s < t.len && i < n; s += 38) {
      for (const side of [-1, 1]) {
        if (i >= n) break
        const p = t.poseAt(s)
        const off = side * (WALL_DIST + 2.2)
        const x = p.x - p.tz * off
        const z = p.z + p.tx * off
        if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 45 && side === this.standSide) continue
        const y = this.gridH(x, z)
        Q.setFromAxisAngle(yAxis, -p.a)
        M.compose(new THREE.Vector3(x, y, z), Q, S)
        poles.setMatrixAt(i, M)
        M.compose(new THREE.Vector3(x, y + 3.0, z), Q, S)
        flags.setMatrixAt(i, M)
        col.setHSL(rng(), 0.85, 0.55)
        flags.setColorAt(i, col)
        i++
      }
    }
    poles.count = flags.count = i
    poles.instanceMatrix.needsUpdate = flags.instanceMatrix.needsUpdate = true
    if (flags.instanceColor) flags.instanceColor.needsUpdate = true
    this.group.add(poles, flags)
  }

  buildClouds () {
    const rng = this.rng
    const mat = new THREE.SpriteMaterial({ map: this.tex.cloud, transparent: true, opacity: 0.9, depthWrite: false })
    this.disposables.push(mat)
    const clouds = []
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(mat)
      const sc = 160 + rng() * 220
      s.scale.set(sc, sc * 0.55, 1)
      s.position.set((rng() * 2 - 1) * 1600, 200 + rng() * 120, (rng() * 2 - 1) * 1600)
      this.group.add(s)
      clouds.push({ s, v: 2 + rng() * 3 })
    }
    this.animated.push({
      update: (time, dt) => {
        for (const c of clouds) {
          c.s.position.x += c.v * dt
          if (c.s.position.x > 1700) c.s.position.x = -1700
        }
      }
    })
  }

  buildBalloons () {
    const rng = this.rng
    const t = this.track
    const cx = (t.minX + t.maxX) / 2
    const cz = (t.minZ + t.maxZ) / 2
    const geo = new THREE.SphereGeometry(6, 24, 16)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i))
      const stripe = Math.floor((ang / (Math.PI * 2) + 0.5) * 12) % 2
      c.set(stripe ? 0xffeb3b : 0xe53935)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // squash bottom into a teardrop
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y < 0) pos.setY(i, y * 1.4)
    }
    geo.computeVertexNormals()
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
    const basketGeo = new THREE.BoxGeometry(1.8, 1.4, 1.8)
    const basketMat = new THREE.MeshStandardMaterial({ map: this.tex.wood, roughness: 0.9 })
    this.disposables.push(geo, mat, basketGeo, basketMat)
    const balloons = []
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group()
      const env = new THREE.Mesh(geo, mat)
      env.castShadow = true
      const basket = new THREE.Mesh(basketGeo, basketMat)
      basket.position.y = -11
      g.add(env, basket)
      const ropes = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 4).translate(0, -9, 0), basketMat)
      g.add(ropes)
      this.disposables.push(ropes.geometry)
      this.group.add(g)
      balloons.push({ g, ph: i * 2.1, r: 160 + i * 90, h: 95 + i * 30, sp: 0.015 + i * 0.005 })
    }
    this.animated.push({
      update: (time) => {
        for (const b of balloons) {
          const a = time * b.sp + b.ph
          b.g.position.set(cx + Math.cos(a) * b.r, b.h + Math.sin(time * 0.3 + b.ph) * 4, cz + Math.sin(a) * b.r)
        }
      }
    })
  }

  buildWindmill () {
    // Put a windmill on a high point away from the track.
    const rng = this.rng
    let best = null
    for (let i = 0; i < 400; i++) {
      const x = this.x0 + 30 + rng() * ((this.cols - 1) * CELL - 60)
      const z = this.z0 + 30 + rng() * ((this.rows - 1) * CELL - 60)
      if (this.trackDist(x, z) < WALL_DIST + 35 || this.isNearPond(x, z, 10)) continue
      if (Math.hypot(x - this.standCenter.x, z - this.standCenter.z) < 60) continue
      const h = this.gridH(x, z)
      if (!best || h > best.h) best = { x, z, h }
    }
    if (!best) return
    const g = new THREE.Group()
    g.position.set(best.x, best.h - 0.3, best.z)
    const white = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.7 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.8 })
    this.disposables.push(white, dark)
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 13, 12), white)
    tower.position.y = 6.5
    tower.castShadow = tower.receiveShadow = true
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 12), dark)
    cap.position.y = 14
    cap.castShadow = true
    const hub = new THREE.Group()
    hub.position.set(0, 12.6, 2.2)
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7.5, 0.12), dark)
      blade.position.y = 3.9
      const arm = new THREE.Group()
      arm.rotation.z = i * Math.PI / 2
      arm.add(blade)
      blade.castShadow = true
      hub.add(arm)
      this.disposables.push(blade.geometry)
    }
    g.add(tower, cap, hub)
    this.disposables.push(tower.geometry, cap.geometry)
    this.group.add(g)
    this.animated.push({ update: (time, dt) => { hub.rotation.z += dt * 0.7 } })
  }

  update (time, dt) {
    this.windUniform.value = time
    if (this.waterMat) {
      this.tex.waterN.offset.set(time * 0.012, time * 0.008)
    }
    for (const a of this.animated) a.update(time, dt)
  }

  setStartLights (n, go) {
    if (!this.startLights) return
    this.startLights.forEach((l, i) => {
      if (go) {
        l.material.emissive.set(0x00ff44)
        l.material.emissiveIntensity = 3
      } else {
        l.material.emissive.set(0xff2200)
        l.material.emissiveIntensity = i < n ? 3 : 0
      }
    })
  }

  dispose () {
    this.scene.remove(this.group)
    this.group.traverse(o => {
      if (o.isInstancedMesh) o.dispose()
    })
    for (const d of this.disposables) d.dispose && d.dispose()
    if (this.sky) {
      this.sky.geometry.dispose()
      this.sky.material.dispose()
    }
    if (this.envTex) this.envTex.dispose()
    for (const l of this.startLights || []) l.material.dispose()
  }
}

let CHECKER = null
function checkerTexture () {
  if (CHECKER) return CHECKER
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 512
  const g = c.getContext('2d')
  const sz = 32
  for (let y = 0; y < 512; y += sz) {
    for (let x = 0; x < 64; x += sz) {
      g.fillStyle = ((x / sz + y / sz) % 2) ? '#f4f4f4' : '#111'
      g.fillRect(x, y, sz, sz)
    }
  }
  CHECKER = new THREE.CanvasTexture(c)
  CHECKER.colorSpace = THREE.SRGBColorSpace
  return CHECKER
}
