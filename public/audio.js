// Synthesised sound effects: engine, tyre squeal, boost, countdown, impacts.
export class GameAudio {
  constructor () {
    this.ctx = null
    this.muted = localStorage.getItem('race.muted') === '1'
  }

  ensure () {
    if (this.ctx) return true
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      this.ctx = new AC()
    } catch {
      return false
    }
    const c = this.ctx
    this.master = c.createGain()
    this.master.gain.value = this.muted ? 0 : 0.5
    this.master.connect(c.destination)

    // Engine: two detuned saws + sub, through a lowpass
    this.engGain = c.createGain()
    this.engGain.gain.value = 0
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    lp.Q.value = 2
    this.engLP = lp
    this.engOsc = []
    for (const [type, det] of [['sawtooth', 0], ['sawtooth', 7], ['square', -1200]]) {
      const o = c.createOscillator()
      o.type = type
      o.detune.value = det
      o.frequency.value = 60
      const g = c.createGain()
      g.gain.value = type === 'square' ? 0.25 : 0.4
      o.connect(g).connect(lp)
      o.start()
      this.engOsc.push(o)
    }
    lp.connect(this.engGain).connect(this.master)

    // Noise source for squeal / boost / dust
    const len = c.sampleRate * 2
    const buf = c.createBuffer(1, len, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    const mk = (type, freq, q) => {
      const src = c.createBufferSource()
      src.buffer = buf
      src.loop = true
      const f = c.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      const g = c.createGain()
      g.gain.value = 0
      src.connect(f).connect(g).connect(this.master)
      src.start()
      return { src, f, g }
    }
    this.squeal = mk('bandpass', 2400, 6)
    this.boostN = mk('bandpass', 700, 1.2)
    this.dust = mk('lowpass', 500, 0.7)
    this.windN = mk('highpass', 1800, 0.5)
    return true
  }

  resume () {
    if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume()
  }

  setMuted (m) {
    this.muted = m
    localStorage.setItem('race.muted', m ? '1' : '0')
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05)
  }

  // speed m/s, throttle 0..1, slip 0..1 (drift), offtrack 0..1, boost 0..1
  engine (speed, throttle, slip, offtrack, boost, active) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const sp = Math.abs(speed)
    const rpm = 55 + sp * 3.6 + boost * 40 + throttle * 12
    for (const o of this.engOsc) o.frequency.setTargetAtTime(rpm, t, 0.05)
    this.engLP.frequency.setTargetAtTime(500 + sp * 40 + throttle * 500 + boost * 900, t, 0.08)
    this.engGain.gain.setTargetAtTime(active ? 0.12 + throttle * 0.12 + Math.min(sp, 40) * 0.003 : 0, t, 0.1)
    this.squeal.g.gain.setTargetAtTime(slip * Math.min(1, sp / 15) * 0.14, t, 0.05)
    this.squeal.f.frequency.setTargetAtTime(1800 + sp * 25, t, 0.1)
    this.boostN.g.gain.setTargetAtTime(boost * 0.2, t, 0.08)
    this.boostN.f.frequency.setTargetAtTime(500 + sp * 30, t, 0.1)
    this.dust.g.gain.setTargetAtTime(offtrack * Math.min(1, sp / 10) * 0.25, t, 0.08)
    this.windN.g.gain.setTargetAtTime(Math.max(0, sp - 20) / 60 * 0.08, t, 0.2)
  }

  beep (freq, dur, vol = 0.35, type = 'square') {
    if (!this.ctx) return
    const c = this.ctx
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = c.createGain()
    g.gain.setValueAtTime(vol, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur)
    o.connect(g).connect(this.master)
    o.start()
    o.stop(c.currentTime + dur)
  }

  countdown (n) {
    if (n > 0) this.beep(440, 0.35)
    else this.beep(880, 0.9, 0.4)
  }

  impact (strength) {
    if (!this.ctx) return
    const c = this.ctx
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 300 + strength * 400
    const g = c.createGain()
    g.gain.setValueAtTime(Math.min(0.9, 0.2 + strength * 0.6), c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25)
    src.connect(f).connect(g).connect(this.master)
    src.start()
    src.stop(c.currentTime + 0.3)
    this.beep(90, 0.2, 0.3, 'sine')
  }

  miniTurbo () {
    this.beep(660, 0.12, 0.25, 'triangle')
    setTimeout(() => this.beep(990, 0.18, 0.25, 'triangle'), 90)
  }

  lap () {
    this.beep(784, 0.15, 0.25, 'triangle')
    setTimeout(() => this.beep(1046, 0.25, 0.25, 'triangle'), 120)
  }

  finish () {
    const notes = [523, 659, 784, 1046]
    notes.forEach((n, i) => setTimeout(() => this.beep(n, 0.35, 0.3, 'triangle'), i * 140))
  }
}
