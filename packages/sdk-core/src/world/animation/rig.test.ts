import test from 'node:test'
import assert from 'node:assert/strict'
import { animation } from './family.ts'
import { paletteReach, PALETTE_FLOATS } from './skeleton.ts'
import { object } from '../object/index.ts'
import { geometry } from '../geometry/index.ts'
import { material } from '../material/index.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { rigReach } from './rigLevers.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { screenErrorBound } from '../../lod/screenErrorBound.ts'

const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`)

/** A chain of three bones one unit apart along y, under a root. */
function chain() {
  const root = object.group(),
    hip = object.group(),
    knee = object.group(),
    foot = object.group()
  ;[hip.name, knee.name, foot.name] = ['hip', 'knee', 'foot']
  knee.position.set(0, 1, 0)
  foot.position.set(0, 1, 0)
  root.add(hip)
  hip.add(knee)
  knee.add(foot)
  root.updateMatrixWorld(true)
  return { root, hip, knee, foot }
}

test('a palette carries a bind vertex where its bone moved it, within the reach it bounds', () => {
  const { root, hip, knee } = chain()
  const skeleton = animation.skeleton([hip, knee])
  knee.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, HALF_PI)
  knee.position.set(0.5, 1, 0)
  root.updateMatrixWorld(true)
  const palette = skeleton.palette(root.matrixWorld.elements, new Float32Array(2 * PALETTE_FLOATS))
  // A vertex at (0, 2, 0) on the knee turns a quarter about z around the knee, then slides.
  const m = palette.subarray(PALETTE_FLOATS)
  const moved = [0, 1, 2].map((row) => m[row * 4] * 0 + m[row * 4 + 1] * 2 + m[row * 4 + 3])
  ;[-0.5, 1, 0].forEach((value, c) => close(moved[c], value))
  // The knee's rest ball (centre (0, 1.5, 0), radius 0.5) moves by at most what the bound says.
  const reach = paletteReach(palette, 0, 2, [0, 0.5, 0, 0.5, 0, 1.5, 0, 0.5])
  assert.ok(reach >= Math.hypot(-0.5 - 0, 1 - 2, 0), `${reach}`)
  assert.equal(
    paletteReach(skeleton.palette(root.matrixWorld.elements, palette), 0, 1, [0, 0.5, 0, 0.5]),
    0,
  )
})

test('an additive action adds its motion from its first key on top of the others', () => {
  const { root, hip } = chain()
  const mixer = animation.createMixer(root)
  const stand = animation.clip('stand', 1, [
    animation.vectorTrack('hip.position', [0, 1], [2, 0, 0, 2, 0, 0]),
  ])
  const nod = animation.clip('nod', 1, [
    animation.vectorTrack('hip.position', [0, 1], [0, 0, 0, 0, 3, 0]),
  ])
  mixer.clipAction(stand).play()
  Object.assign(mixer.clipAction(nod), { blendMode: 'additive', weight: 0.5 }).play()
  mixer.update(0.5)
  ;[2, 0.75, 0].forEach((value, c) =>
    close([hip.position.x, hip.position.y, hip.position.z][c], value),
  )
})

test('a weights track writes every morph weight of a mesh, and a cubic spline follows its tangents', () => {
  const box = geometry.box(1, 1, 1)
  box.morphAttributes.position = [box.attributes.position, box.attributes.position]
  const mesh = object.mesh(box, material.meshBasic())
  mesh.name = 'face'
  const root = object.group().add(mesh)
  const smile = animation.clip('smile', 1, [
    animation.weightsTrack('face.morphTargetInfluences', [0, 1], [0, 1, 1, 0]),
    {
      ...animation.vectorTrack(
        'face.position',
        [0, 1],
        [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
      interpolation: 'cubic',
    },
  ])
  const mixer = animation.createMixer(root)
  mixer.clipAction(smile).play()
  mixer.update(0.25)
  assert.deepEqual(mesh.morphTargetInfluences, [0.25, 0.75])
  // Out-tangent (1, 0, 0) at the first key, one second long: x = t − 2t² + t³ at a quarter.
  close(mesh.position.x, 0.25 - 2 * 0.0625 + 0.015625)
})

test('a two-bone chain bent by IK puts its end on a reachable target', () => {
  const { hip, knee, foot } = chain()
  animation.twoBoneIK(hip, knee, foot, { x: 1, y: 1, z: 0 })
  const end = foot.getWorldPosition()
  ;[1, 1, 0].forEach((value, c) => close([end.x, end.y, end.z][c], value, 1e-6))
})

test('wind bends each bone no further than the angle it declares', () => {
  const { hip, knee, foot } = chain()
  const clip = animation.windClip([hip, knee, foot], { direction: [1, 0], angle: 0.2 })
  for (const track of clip.tracks)
    for (let k = 0; k < track.times.length; k++) {
      const w = Math.min(1, Math.abs(track.values[k * 4 + 3]))
      assert.ok(2 * Math.acos(w) <= 0.2 + 1e-6)
    }
})

test('rig levers under the length rule keep the hold verdict of `Math.hypot` over a sweep', () => {
  for (let n = 1; n <= 4096; n++) {
    const h = (base: number, shift = 0) => 4 * halton(n + shift, base) - 2
    const root = object.group(),
      arm = object.group(),
      hand = object.mesh(geometry.box(1 + h(2), 1 + h(3), 1 + h(5)))
    ;[arm.name, hand.name] = ['arm', 'hand']
    root.add(arm.add(hand))
    arm.position.set(h(7), h(2, 99), n % 7 ? h(3, 99) : 0)
    arm.scale.set(h(5, 99), 1, n % 5 ? h(7, 99) : 0)
    hand.position.set(h(2, 199), n % 3 ? h(3, 199) : -0, h(5, 199))
    hand.scale.setScalar(h(7, 199))
    const turn = (name: string) => animation.quaternionTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    const reach = rigReach(root, [
      animation.clip('c', 1, [turn('arm.quaternion'), turn('hand.quaternion')]),
    ])
    // The levers and radius as `Math.hypot` gave them: the oracle.
    const box = hand.localBounds()!,
      grow = (node: typeof arm | typeof hand) =>
        Math.max(...[node.scale.x, node.scale.y, node.scale.z].map(Math.abs))
    let handSpan = 0
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) handSpan = Math.max(handSpan, Math.hypot(x, y, z))
    const p = hand.position,
      q = arm.position,
      armSpan = Math.max(0, Math.hypot(p.x, p.y, p.z) + grow(hand) * handSpan),
      radius = 1 * Math.max(0, Math.hypot(q.x, q.y, q.z) + grow(arm) * armSpan)
    const was = [radius, 1 * grow(arm) * armSpan, 1 * grow(arm) * 1 * grow(hand) * handSpan],
      now = [
        reach.radius,
        reach.levers.get('arm.quaternion')!,
        reach.levers.get('hand.quaternion')!,
      ]
    // The hold verdict (`mixerHold.ts`): a lever's drift over a frame, as pixels in the rig's ball,
    // below half a pixel; the focal length puts the old drift near it, where a verdict could turn.
    const depth = 3 + 99 * halton(n, 11),
      verdict = (lever: number, ball: number, focal: number) =>
        screenErrorBound(lever / 120, 1, halton(n, 13), depth, ball, focal, 0.1) < 0.5
    for (let k = 0; k < 3; k++) {
      const seen = `rig ${n} term ${k}: ${now[k]} / ${was[k]}`
      assert.ok(Math.abs(now[k] - was[k]) <= 2 ** -46 * was[k], seen)
      if (!(was[1] > 0 && was[2] > 0) || k === 0) continue
      const focal = ((0.25 + 0.5 * halton(n, 17)) * depth * 120) / was[k]
      assert.equal(verdict(now[k], now[0], focal), verdict(was[k], was[0], focal), seen)
    }
  }
})
