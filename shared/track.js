// Shared track geometry. Units are metres. The track lives on the XZ plane
// (x = east, z = south); elevation along the lap is a smooth profile in `elev(s)`.

export const WORLD_W = 660
export const WORLD_H = 380
export const HALF_W = 7          // half width of the asphalt ribbon
export const SHOULDER = 2.2      // rumble strip / verge width beyond HALF_W
export const WALL_DIST = HALF_W + 4.5 // barrier distance from the centreline
export const TOTAL_LAPS = 2
export const MAX_PLAYERS = 14

// Control points were laid out in a 1700x980 grid and are mapped to metres here.
const SX = 0.385
const SZ = 0.385
const map = pts => pts.map(([x, y]) => [(x - 850) * SX, (y - 490) * SZ])

const MAP_DEFS = [
  {
    name: 'Sunset Loop',
    seed: 11,
    hills: [[7, 1, 0.4], [3.5, 2, 2.1], [1.2, 5, 4.0]],
    ctrl: map([
      [720, 880], [1120, 860], [1420, 800], [1580, 620], [1600, 420],
      [1500, 260], [1280, 180], [1050, 240], [900, 360], [740, 470],
      [560, 420], [400, 520], [300, 680], [280, 850]
    ])
  },
  {
    name: 'Lakeside Oval',
    seed: 23,
    hills: [[4, 1, 1.0], [2.5, 3, 0.3], [1.0, 6, 2.2]],
    ctrl: map([
      [850, 890], [1350, 870], [1590, 720], [1630, 480], [1520, 260],
      [1250, 150], [800, 140], [450, 190], [230, 340], [180, 560],
      [240, 760], [350, 860]
    ])
  },
  {
    name: 'Twister Pass',
    seed: 37,
    hills: [[9, 1, 2.6], [3, 2, 0.9], [1.5, 4, 1.4]],
    ctrl: map([
      [880, 900], [1300, 880], [1520, 720], [1560, 500], [1400, 350],
      [1130, 310], [940, 210], [690, 160], [500, 250], [600, 430],
      [420, 530], [280, 670], [430, 850]
    ])
  },
  {
    name: 'Highland Hook',
    seed: 51,
    hills: [[11, 1, 5.2], [4, 2, 3.3], [1.4, 5, 0.7]],
    ctrl: map([
      [900, 890], [1330, 860], [1580, 660], [1560, 420], [1380, 300],
      [1420, 170], [1150, 120], [880, 220], [760, 420], [560, 480],
      [360, 380], [200, 520], [260, 760], [460, 875]
    ])
  },
  // Technical / drift set: tight sustained corners, hairpins, esses and chicanes (min radius ~18-20 m).
  {
    name: 'Hairpin Harbour',
    seed: 67,
    hills: [[4, 1, 0.8], [2, 3, 2]],
    ctrl: map([
      [660, 880], [1000, 880], [1220, 860], [1350, 750], [1340, 610],
      [1250, 540], [860, 542], [816, 524], [798, 480], [816, 436],
      [860, 418], [1250, 422], [1294, 404], [1312, 360], [1294, 316],
      [1250, 298], [1060, 300], [990, 250], [890, 250], [820, 300],
      [640, 300], [480, 300], [380, 330], [330, 430], [350, 560],
      [440, 620], [420, 720], [360, 790], [400, 880]
    ])
  },
  {
    name: 'Serpent Run',
    seed: 73,
    hills: [[5, 1, 2.5], [2.5, 2, 0.6]],
    ctrl: map([
      [680, 880], [1030, 880], [1280, 860], [1400, 780], [1360, 660],
      [1430, 540], [1370, 420], [1320, 320], [1230, 265], [1110, 375],
      [990, 265], [870, 375], [750, 265], [630, 375], [510, 265],
      [390, 375], [330, 378], [286, 396], [268, 440], [286, 484],
      [330, 502], [630, 502], [674, 520], [692, 564], [674, 608],
      [630, 626], [380, 626], [280, 690], [280, 800], [430, 880]
    ])
  },
  {
    name: 'Corkscrew Alley',
    seed: 89,
    hills: [[6, 1, 4.1], [3, 2, 1.7], [1.5, 5, 3]],
    ctrl: map([
      [650, 880], [950, 880], [1050, 870], [1110, 820], [1200, 810],
      [1290, 800], [1370, 780], [1390, 700], [1340, 620], [1410, 520],
      [1340, 420], [1400, 320], [1380, 250], [1330, 200], [1260, 180],
      [1180, 172], [1110, 180], [1070, 230], [1050, 300], [1050, 400],
      [1032, 444], [988, 462], [944, 444], [926, 400], [926, 250],
      [908, 206], [864, 188], [820, 206], [802, 250], [802, 600],
      [760, 700], [680, 740], [560, 750], [500, 700], [440, 690],
      [380, 740], [300, 756], [256, 774], [238, 818], [256, 862],
      [300, 880]
    ])
  },
  {
    name: 'Knotted Pines',
    seed: 97,
    hills: [[7, 1, 1.2], [3, 2, 4.4], [1.2, 4, 0.2]],
    ctrl: map([
      [770, 728], [1007, 728], [1061, 706], [1078, 665], [1061, 624],
      [1007, 602], [960, 602], [915, 587], [835, 627], [760, 602],
      [707, 602], [585, 550], [528, 415], [585, 280], [707, 228],
      [1000, 228], [1044, 246], [1062, 290], [1044, 334], [1000, 352],
      [733, 352], [679, 374], [662, 415], [679, 456], [733, 478],
      [780, 478], [825, 493], [905, 453], [980, 478], [1033, 478],
      [1155, 530], [1212, 665], [1155, 800], [1033, 852], [770, 852],
      [560, 852], [516, 834], [498, 790], [516, 746], [560, 728]
    ])
  }
]

export class Track {
  constructor (def) {
    this.name = def.name
    this.seed = def.seed
    this.hills = def.hills
    this.ctrl = def.ctrl
    this.pts = []
    this.len = 0
    this.build()
  }

  build () {
    // Chaikin smoothing then Catmull-Rom, resampled to ~2 m spacing.
    let c = this.ctrl
    for (let round = 0; round < 2; round++) {
      const cut = []
      const n = c.length
      for (let i = 0; i < n; i++) {
        const a = c[i]
        const b = c[(i + 1) % n]
        cut.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
        cut.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
      }
      c = cut
    }
    const dense = []
    const n = c.length
    for (let i = 0; i < n; i++) {
      const p0 = c[(i - 1 + n) % n]
      const p1 = c[i]
      const p2 = c[(i + 1) % n]
      const p3 = c[(i + 2) % n]
      for (let s = 0; s < 32; s++) dense.push(catmull(p0, p1, p2, p3, s / 32))
    }
    const spacing = 2
    let acc = 0
    this.pts.push({ x: dense[0].x, z: dense[0].z })
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[(i - 1) % dense.length]
      const b = dense[i % dense.length]
      acc += Math.hypot(b.x - a.x, b.z - a.z)
      if (acc >= spacing) {
        acc = 0
        this.pts.push({ x: b.x, z: b.z })
      }
    }
    // Drop the last point if it nearly coincides with the first.
    const f = this.pts[0]
    const l = this.pts[this.pts.length - 1]
    if (Math.hypot(f.x - l.x, f.z - l.z) < spacing * 0.5) this.pts.pop()

    const m = this.pts.length
    this.len = 0
    for (let i = 0; i < m; i++) {
      const a = this.pts[i]
      const b = this.pts[(i + 1) % m]
      a.s = this.len
      a.tx = b.x - a.x
      a.tz = b.z - a.z
      const d = Math.hypot(a.tx, a.tz) || 1
      a.tx /= d
      a.tz /= d
      this.len += d
    }
    // Curvature (signed) for banking / scenery decisions.
    for (let i = 0; i < m; i++) {
      const p = this.pts[(i - 3 + m) % m]
      const q = this.pts[(i + 3) % m]
      const cross = p.tx * q.tz - p.tz * q.tx
      this.pts[i].k = cross / 12
    }
    this.minX = Math.min(...this.pts.map(p => p.x))
    this.maxX = Math.max(...this.pts.map(p => p.x))
    this.minZ = Math.min(...this.pts.map(p => p.z))
    this.maxZ = Math.max(...this.pts.map(p => p.z))
  }

  // Elevation of the track centreline at arc length s.
  elev (s) {
    const t = (s / this.len) * Math.PI * 2
    let h = 0
    for (const [amp, freq, ph] of this.hills) h += amp * Math.sin(t * freq + ph)
    // Keep the start/finish straight flat-ish so the grid sits level.
    const w = smooth01(Math.min(s, this.len - s) / 70)
    return h * w
  }

  at (s) {
    const m = this.pts.length
    s = ((s % this.len) + this.len) % this.len
    let lo = 0
    let hi = m - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.pts[mid].s <= s) lo = mid
      else hi = mid - 1
    }
    return { pt: this.pts[lo], next: this.pts[(lo + 1) % m], idx: lo }
  }

  poseAt (s) {
    const { pt, next } = this.at(s)
    const seg = Math.hypot(next.x - pt.x, next.z - pt.z) || 1
    const f = Math.max(0, Math.min(1, (s - pt.s) / seg))
    const x = pt.x + (next.x - pt.x) * f
    const z = pt.z + (next.z - pt.z) * f
    return { x, z, a: Math.atan2(pt.tz, pt.tx), tx: pt.tx, tz: pt.tz, y: this.elev(s) }
  }

  gridPose (slot) {
    const back = 12 + Math.floor(slot / 2) * 7.5
    const lat = (slot % 2 === 0 ? -1 : 1) * 2.7
    const p = this.poseAt(this.len - back)
    return { x: p.x - p.tz * lat, z: p.z + p.tx * lat, a: p.a, y: p.y }
  }

  nearest (x, z, hint) {
    const m = this.pts.length
    let bestI = 0
    let bestD = Infinity
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = ((hint + k) % m + m) % m
        const d = (this.pts[i].x - x) ** 2 + (this.pts[i].z - z) ** 2
        if (d < bestD) {
          bestD = d
          bestI = i
        }
      }
      if (bestD < 60 * 60) return this.refine(x, z, bestI)
    }
    bestD = Infinity
    for (let i = 0; i < m; i += 3) {
      const d = (this.pts[i].x - x) ** 2 + (this.pts[i].z - z) ** 2
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    return this.refine(x, z, bestI)
  }

  refine (x, z, idx) {
    const m = this.pts.length
    let bi = idx
    let bd = Infinity
    let bt = 0
    let side = 0
    for (const i of [((idx - 2) % m + m) % m, ((idx - 1) % m + m) % m, idx, (idx + 1) % m, (idx + 2) % m]) {
      const a = this.pts[i]
      const b = this.pts[(i + 1) % m]
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
      const px = a.x + abx * t
      const pz = a.z + abz * t
      const d = (px - x) ** 2 + (pz - z) ** 2
      if (d < bd) {
        bd = d
        bi = i
        bt = t
        side = Math.sign(abx * (z - a.z) - abz * (x - a.x))
      }
    }
    const a = this.pts[bi]
    const b = this.pts[(bi + 1) % m]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    const s = a.s + seg * bt
    return { idx: bi, dist: Math.sqrt(bd), prog: s / this.len, s, side, tx: a.tx, tz: a.tz, cx: a.x + (b.x - a.x) * bt, cz: a.z + (b.z - a.z) * bt }
  }
}

function smooth01 (t) {
  t = Math.max(0, Math.min(1, t))
  return t * t * (3 - 2 * t)
}

function catmull (p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    z: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  }
}

export const tracks = MAP_DEFS.map(d => new Track(d))
export function trackByName (name) {
  return tracks.find(t => t.name === name) || tracks[0]
}
