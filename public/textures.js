// Procedural textures generated on 2D canvases so the game needs no image assets.
import * as THREE from 'three'
import { mulberry32, fbm } from './noise.js'

function canvas (w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function tex (c, repeat = true) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  t.anisotropy = 16
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function noiseFill (ctx, w, h, base, amp, seed, scale = 0.05, octaves = 3) {
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Tileable by sampling on a torus-ish trick: average two offset samples.
      const n = (fbm(x * scale, y * scale, octaves, seed) + fbm((x + w) * scale, (y + h) * scale, octaves, seed)) * 0.5
      const i = (y * w + x) * 4
      d[i] = Math.max(0, Math.min(255, base[0] + n * amp[0]))
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n * amp[1]))
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n * amp[2]))
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

export function asphaltTexture () {
  const w = 512
  const h = 512
  const c = canvas(w, h)
  const g = c.getContext('2d')
  noiseFill(g, w, h, [62, 63, 66], [22, 22, 24], 3, 0.09, 4)
  // speckle
  const rng = mulberry32(9)
  for (let i = 0; i < 9000; i++) {
    const v = 40 + rng() * 60
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.35})`
    g.fillRect(rng() * w, rng() * h, 1.5, 1.5)
  }
  // grime bands where tyres run (u ~0.3 / 0.7)
  const grad = g.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.24, 'rgba(0,0,0,0)')
  grad.addColorStop(0.3, 'rgba(0,0,0,0.22)')
  grad.addColorStop(0.36, 'rgba(0,0,0,0)')
  grad.addColorStop(0.64, 'rgba(0,0,0,0)')
  grad.addColorStop(0.7, 'rgba(0,0,0,0.22)')
  grad.addColorStop(0.76, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  // edge lines (u across = x)
  g.fillStyle = 'rgba(235,235,230,0.92)'
  g.fillRect(w * 0.03, 0, w * 0.02, h)
  g.fillRect(w * 0.95, 0, w * 0.02, h)
  // centre dashes (v along = y), one tile = 10 m, dash for half of it
  g.fillStyle = 'rgba(240,240,235,0.85)'
  g.fillRect(w * 0.492, 0, w * 0.016, h * 0.45)
  const t = tex(c)
  t.wrapS = THREE.ClampToEdgeWrapping
  return t
}

export function curbTexture () {
  const w = 64
  const h = 256
  const c = canvas(w, h)
  const g = c.getContext('2d')
  g.fillStyle = '#c62828'
  g.fillRect(0, 0, w, h / 2)
  g.fillStyle = '#eceff1'
  g.fillRect(0, h / 2, w, h / 2)
  const rng = mulberry32(4)
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(0,0,0,${rng() * 0.18})`
    g.fillRect(rng() * w, rng() * h, 2, 2)
  }
  return tex(c)
}

export function gravelTexture () {
  const c = canvas(256, 256)
  const g = c.getContext('2d')
  noiseFill(g, 256, 256, [128, 116, 92], [40, 36, 30], 21, 0.12, 3)
  const rng = mulberry32(77)
  for (let i = 0; i < 2500; i++) {
    const v = 90 + rng() * 90
    g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.6)`
    g.fillRect(rng() * 256, rng() * 256, 2, 2)
  }
  return tex(c)
}

export function grassTexture () {
  const c = canvas(512, 512)
  const g = c.getContext('2d')
  noiseFill(g, 512, 512, [110, 150, 70], [40, 44, 30], 5, 0.06, 4)
  const rng = mulberry32(13)
  for (let i = 0; i < 26000; i++) {
    const x = rng() * 512
    const y = rng() * 512
    const gr = 100 + rng() * 90
    g.strokeStyle = `rgba(${gr * 0.55},${gr},${gr * 0.35},0.5)`
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + rng() * 3 - 1.5, y - 2 - rng() * 4)
    g.stroke()
  }
  return tex(c)
}

export function metalTexture () {
  const c = canvas(128, 128)
  const g = c.getContext('2d')
  noiseFill(g, 128, 128, [175, 178, 182], [30, 30, 32], 8, 0.15, 2)
  // corrugation: two darker horizontal bands
  const grad = g.createLinearGradient(0, 0, 0, 128)
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    grad.addColorStop(t, i % 2 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.12)')
  }
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return tex(c)
}

export function concreteTexture () {
  const c = canvas(256, 256)
  const g = c.getContext('2d')
  noiseFill(g, 256, 256, [150, 150, 148], [26, 26, 26], 31, 0.08, 3)
  return tex(c)
}

export function woodTexture () {
  const c = canvas(256, 256)
  const g = c.getContext('2d')
  noiseFill(g, 256, 256, [120, 84, 50], [40, 30, 20], 45, 0.02, 3)
  const rng = mulberry32(3)
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(60,35,15,${0.15 + rng() * 0.3})`
    g.lineWidth = 1 + rng() * 2
    g.beginPath()
    g.moveTo(0, rng() * 256)
    g.bezierCurveTo(80, rng() * 256, 170, rng() * 256, 256, rng() * 256)
    g.stroke()
  }
  return tex(c)
}

export function grassBladeTexture () {
  const c = canvas(128, 128)
  const g = c.getContext('2d')
  g.clearRect(0, 0, 128, 128)
  const rng = mulberry32(99)
  for (let i = 0; i < 14; i++) {
    const x0 = 10 + rng() * 108
    const h = 60 + rng() * 64
    const lean = rng() * 30 - 15
    const shade = 90 + rng() * 80
    g.strokeStyle = `rgb(${shade * 0.6},${shade},${shade * 0.35})`
    g.lineWidth = 3 + rng() * 3
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(x0, 128)
    g.quadraticCurveTo(x0 + lean * 0.3, 128 - h * 0.6, x0 + lean, 128 - h)
    g.stroke()
  }
  const t = tex(c, false)
  return t
}

export function cloudTexture () {
  const c = canvas(256, 256)
  const g = c.getContext('2d')
  const rng = mulberry32(5)
  for (let i = 0; i < 26; i++) {
    const x = 60 + rng() * 136
    const y = 90 + rng() * 80
    const r = 25 + rng() * 45
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.7, 'rgba(255,255,255,0.18)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
  }
  const t = tex(c, false)
  return t
}

export function softDotTexture () {
  const c = canvas(64, 64)
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return tex(c, false)
}

export function waterNormalTexture () {
  const w = 256
  const c = canvas(w, w)
  const g = c.getContext('2d')
  const img = g.createImageData(w, w)
  const d = img.data
  const hgt = (x, y) => {
    const k = Math.PI * 2 / w
    return Math.sin(x * k * 3 + y * k * 2) * 0.5 + Math.sin(x * k * 7 - y * k * 5) * 0.25 + Math.sin(y * k * 11 + x * k * 4) * 0.15 + fbm(x * 0.04, y * 0.04, 2, 8) * 0.4
  }
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y)
      const dy = hgt(x, y + 1) - hgt(x, y - 1)
      const i = (y * w + x) * 4
      d[i] = 128 + dx * -90
      d[i + 1] = 128 + dy * -90
      d[i + 2] = 255
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = tex(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

export function bannerTexture (text, bg = '#111', fg = '#fff') {
  const c = canvas(1024, 256)
  const g = c.getContext('2d')
  g.fillStyle = bg
  g.fillRect(0, 0, 1024, 256)
  const sz = 32
  for (let y = 0; y < 256; y += sz) {
    for (let x = 0; x < 1024; x += sz) {
      if (x < 160 || x > 1024 - 160) {
        g.fillStyle = ((x / sz + y / sz) % 2) ? '#f2f2f2' : '#101010'
        g.fillRect(x, y, sz, sz)
      }
    }
  }
  g.fillStyle = fg
  g.font = '900 150px ui-sans-serif, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 512, 132)
  const t = tex(c, false)
  return t
}

// Floating label over a rival's car: an optional place badge ("3rd") in
// podium colours followed by the driver's name.
const PLACE_COLORS = ['#ffd54f', '#e0e0e0', '#e0955b']
export function ordinal (n) {
  const r = n % 100
  if (r >= 11 && r <= 13) return n + 'th'
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th')
}

export function carLabelTexture (name, place = 0) {
  const c = canvas(768, 128)
  const g = c.getContext('2d')
  g.clearRect(0, 0, 768, 128)
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 12
  g.strokeStyle = 'rgba(0,0,0,0.75)'
  const nameFont = '800 60px ui-sans-serif, system-ui, sans-serif'
  const badgeFont = '900 62px ui-sans-serif, system-ui, sans-serif'
  g.font = nameFont
  let nameW = g.measureText(name).width
  const maxName = place > 0 ? 470 : 720
  if (nameW > maxName) {
    // Shrink long names rather than clipping them; a 20-char name of wide
    // glyphs next to a place badge needs to go well under 30px to fit.
    g.font = '800 ' + Math.max(18, Math.floor(60 * maxName / nameW)) + 'px ui-sans-serif, system-ui, sans-serif'
    nameW = g.measureText(name).width
  }
  const nameFontUsed = g.font
  let badgeW = 0
  let badge = ''
  if (place > 0) {
    badge = ordinal(place)
    g.font = badgeFont
    badgeW = g.measureText(badge).width + 44
  }
  const gap = place > 0 ? 22 : 0
  let x = (768 - (badgeW + gap + nameW)) / 2
  if (place > 0) {
    const col = PLACE_COLORS[place - 1] || '#ffffff'
    g.fillStyle = 'rgba(0,0,0,0.7)'
    g.beginPath()
    g.roundRect(x, 14, badgeW, 100, 22)
    g.fill()
    g.lineWidth = 5
    g.strokeStyle = col
    g.stroke()
    g.font = badgeFont
    g.textAlign = 'center'
    g.fillStyle = col
    g.fillText(badge, x + badgeW / 2, 66)
    x += badgeW + gap
    g.lineWidth = 12
    g.strokeStyle = 'rgba(0,0,0,0.75)'
  }
  g.font = nameFontUsed
  g.textAlign = 'left'
  g.strokeText(name, x, 64)
  g.fillStyle = '#ffffff'
  g.fillText(name, x, 64)
  const t = tex(c, false)
  t.anisotropy = 8
  return t
}

export function labelTexture (text, color = '#ffffff') {
  const c = canvas(512, 128)
  const g = c.getContext('2d')
  g.clearRect(0, 0, 512, 128)
  g.font = '800 64px ui-sans-serif, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 12
  g.strokeStyle = 'rgba(0,0,0,0.75)'
  g.strokeText(text, 256, 64)
  g.fillStyle = color
  g.fillText(text, 256, 64)
  const t = tex(c, false)
  t.anisotropy = 8
  return t
}
