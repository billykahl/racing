// Seeded PRNG + value-noise / fBm helpers used for terrain and procedural textures.

export function mulberry32 (a) {
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function strSeed (s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash2 (ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function fade (t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// Value noise in [-1, 1]
export function vnoise (x, z, seed = 0) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fz = fade(z - iz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  const v = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  return v * 2 - 1
}

export function fbm (x, z, octaves = 4, seed = 0, lac = 2.03, gain = 0.5) {
  let amp = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x, z, seed + i * 17) * amp
    norm += amp
    amp *= gain
    x *= lac
    z *= lac
  }
  return sum / norm
}

export function smooth01 (t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

export function clamp (v, a, b) {
  return v < a ? a : v > b ? b : v
}

export function lerp (a, b, t) {
  return a + (b - a) * t
}
