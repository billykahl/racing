// Procedural car model. Nose points along local +x; wheels spin around local z.
import * as THREE from 'three'
import { carLabelTexture } from './textures.js'

let SHARED = null
function shared () {
  if (SHARED) return SHARED
  // Lower body side profile (x = length, y = height)
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

  // Cabin (dark glass) with a painted roof on top
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

  const tyreGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 20)
  tyreGeo.rotateX(Math.PI / 2)
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.32, 12)
  rimGeo.rotateX(Math.PI / 2)
  const spokeGeo = new THREE.BoxGeometry(0.4, 0.07, 0.34)
  const headGeo = new THREE.BoxGeometry(0.08, 0.16, 0.4)
  const tailGeo = new THREE.BoxGeometry(0.06, 0.14, 0.5)
  const spoilerGeo = new THREE.BoxGeometry(0.35, 0.06, 1.7)
  const strutGeo = new THREE.BoxGeometry(0.12, 0.34, 0.08)
  const flameGeo = new THREE.ConeGeometry(0.13, 0.9, 10)
  flameGeo.rotateZ(Math.PI / 2)
  flameGeo.translate(-0.45, 0, 0)
  const bumperGeo = new THREE.BoxGeometry(0.16, 0.2, 1.62)
  const mirrorGeo = new THREE.BoxGeometry(0.12, 0.1, 0.22)

  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.92 })
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 })
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f1a24, roughness: 0.05, metalness: 0.4, envMapIntensity: 1.6, clearcoat: 1 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.6 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.2 })
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })

  SHARED = { bodyGeo, glassGeo, roofGeo, tyreGeo, rimGeo, spokeGeo, headGeo, tailGeo, spoilerGeo, strutGeo, flameGeo, bumperGeo, mirrorGeo, tyreMat, rimMat, glassMat, trimMat, headMat, flameMat }
  return SHARED
}

export class Car {
  constructor (colorHex, name, isSelf) {
    const S = shared()
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

    const body = new THREE.Mesh(S.bodyGeo, this.paint)
    body.castShadow = true
    body.receiveShadow = true
    this.group.add(body)
    const glass = new THREE.Mesh(S.glassGeo, S.glassMat)
    glass.castShadow = true
    this.group.add(glass)
    const roof = new THREE.Mesh(S.roofGeo, this.paint)
    roof.castShadow = true
    this.group.add(roof)
    const spoiler = new THREE.Mesh(S.spoilerGeo, this.paint)
    spoiler.position.set(-1.95, 1.2, 0)
    spoiler.castShadow = true
    this.group.add(spoiler)
    for (const z of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(S.strutGeo, S.trimMat)
      strut.position.set(-1.9, 1.0, z)
      this.group.add(strut)
      const head = new THREE.Mesh(S.headGeo, S.headMat)
      head.position.set(2.17, 0.6, z)
      this.group.add(head)
      const tail = new THREE.Mesh(S.tailGeo, this.tailMat)
      tail.position.set(-2.12, 0.58, z)
      this.group.add(tail)
      const mirror = new THREE.Mesh(S.mirrorGeo, this.paint)
      mirror.position.set(0.95, 1.0, z * 1.5)
      this.group.add(mirror)
    }
    for (const x of [2.13, -2.1]) {
      const b = new THREE.Mesh(S.bumperGeo, S.trimMat)
      b.position.set(x, 0.36, 0)
      this.group.add(b)
    }
    this.flames = []
    for (const z of [-0.45, 0.45]) {
      const f = new THREE.Mesh(S.flameGeo, S.flameMat)
      f.position.set(-2.15, 0.36, z)
      f.visible = false
      f.userData.noAO = true
      this.group.add(f)
      this.flames.push(f)
    }
    this.frontWheels = []
    this.rearWheels = []
    this.frontSpins = []
    this.rearSpins = []
    for (const [x, z] of [[1.35, -0.98], [1.35, 0.98], [-1.35, -0.98], [-1.35, 0.98]]) {
      const pivot = new THREE.Group()
      pivot.position.set(x, 0.37, z)
      const spin = new THREE.Group()
      const tyre = new THREE.Mesh(S.tyreGeo, S.tyreMat)
      tyre.castShadow = true
      const rim = new THREE.Mesh(S.rimGeo, S.rimMat)
      const spoke = new THREE.Mesh(S.spokeGeo, S.rimMat)
      const spoke2 = new THREE.Mesh(S.spokeGeo, S.rimMat)
      spoke2.rotation.z = Math.PI / 2
      spin.add(tyre, rim, spoke, spoke2)
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
    this.wheelRot += speed * dt / 0.37
    for (const w of this.frontSpins) w.rotation.z = -this.wheelRot
    // Rear tyres overspin while drifting so the back end visibly churns; churn at least a minimum rate.
    if (drift) {
      const dir = speed < 0 ? -1 : 1
      this.rearRot += dir * Math.max(Math.abs(speed) * 1.7, 14) * dt / 0.37
    } else {
      this.rearRot += speed * dt / 0.37
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

  dispose () {
    this.paint.dispose()
    this.tailMat.dispose()
    if (this.label) {
      this.label.material.map.dispose()
      this.label.material.dispose()
    }
  }
}
