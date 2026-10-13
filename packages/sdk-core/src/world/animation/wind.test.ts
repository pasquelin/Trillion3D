import test from 'node:test'
import assert from 'node:assert/strict'
import { windClip } from './wind.ts'
import { Object3D } from '../object/object3d.ts'
import { Quaternion } from '../math/quaternion.ts'
import { Vector3 } from '../math/vector3.ts'
import type { Track } from './clip.ts'

/** Each key of a quaternion track. */
const keys = (track: Track) =>
  Array.from(track.times, (_, k) => new Quaternion().fromArray(track.values, k * 4))
/** How far a key turns a bone from its rest, in radians (stable near zero, unlike an arccosine). */
const lean = (key: Quaternion, rest = new Quaternion()) => {
  const { x, y, z, w } = rest.clone().invert().multiply(key)
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w))
}
/** The key at which the bone leans most. */
const peak = (track: Track) => {
  const leans = keys(track).map((key) => lean(key))
  const at = leans.indexOf(Math.max(...leans))
  return { at, time: track.times[at], lean: leans[at], key: keys(track)[at] }
}

test('a wind clip covers one sway, closes on its first key and leans its outer bone by the angle', () => {
  const bone = new Object3D()
  bone.name = 'leaf'
  const clip = windClip([bone], { angle: 0.4, frequency: 2 })
  assert.equal(clip.duration, 0.5, 'one sway at two a second')
  assert.equal(clip.tracks.length, 1)
  const track = clip.tracks[0]
  assert.equal(track.name, 'leaf.quaternion', 'bound to the bone it turns')
  assert.equal(track.kind, 'quaternion')
  assert.equal(track.times[0], 0)
  assert.equal(track.times.at(-1), clip.duration)
  assert.equal(track.values.length, track.times.length * 4)
  for (let i = 1; i < track.times.length; i++) assert.ok(track.times[i] > track.times[i - 1])
  const all = keys(track)
  assert.ok(lean(all[0], all.at(-1)) < 1e-6, 'the loop closes without a jump')
  for (const key of all) {
    assert.ok(lean(key) > 0, 'leant with the wind at every key')
    // Every key turns about the axis across the wind: for a wind along +x, the -z axis.
    const axis = new Vector3(key.x, key.y, key.z).normalize()
    assert.ok(axis.distanceTo(new Vector3(0, 0, -1)) < 1e-6)
  }
  assert.ok(Math.abs(peak(track).lean - 0.4) < 1e-6, 'the outer bone reaches the angle')
  assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1], 'the bone itself is not posed')
})

test('ground-plane wind direction is normalized and pushes the upright tip toward that direction', () => {
  const bone = new Object3D()
  const first = windClip([bone], { direction: [3, 4], angle: 0.6, frequency: 1 })
  const scaled = windClip([bone], { direction: [6, 8], angle: 0.6, frequency: 1 })
  assert.deepEqual(first.tracks[0].values, scaled.tracks[0].values)
  const tip = new Vector3(0, 1, 0).applyQuaternion(peak(first.tracks[0]).key)
  assert.ok(Math.abs(tip.y - Math.cos(0.6)) < 1e-6, 'bent by the angle')
  assert.ok(tip.x > 0 && Math.abs(tip.x / tip.z - 3 / 4) < 1e-6, 'toward the wind, along it')
})

test('outer foliage bends more and reaches its peak later than the inner bone', () => {
  const inner = new Object3D(),
    outer = new Object3D()
  inner.name = 'branch'
  outer.name = 'leaf'
  const clip = windClip([inner, outer], { angle: 0.6, frequency: 1 })
  const branch = peak(clip.tracks[0]),
    leaf = peak(clip.tracks[1])
  assert.ok(Math.abs(leaf.lean - 0.6) < 1e-6)
  assert.ok(branch.lean > 0 && branch.lean < leaf.lean)
  assert.ok(branch.time < leaf.time)
})

test('the wind axis stays in world space with a rotated parent and a nonidentity rest pose', () => {
  const parent = new Object3D(),
    bone = new Object3D()
  parent.add(bone)
  parent.rotation.set(0.3, -0.7, 1.1)
  bone.rotation.set(0.2, 0.5, -0.4)
  const restWorld = bone.getWorldQuaternion()
  const parentWorld = parent.getWorldQuaternion()
  const clip = windClip([bone], { angle: 0.4, frequency: 1 })
  for (const key of keys(clip.tracks[0])) {
    // The turn the key adds, seen in the world: world pose after rest⁻¹.
    const turn = parentWorld.clone().multiply(key).multiply(restWorld.clone().invert())
    const axis = new Vector3(turn.x, turn.y, turn.z).normalize()
    assert.ok(axis.distanceTo(new Vector3(0, 0, -1)) < 1e-6)
  }
})

test('an explicit zero amplitude preserves every rest key and no bone makes no track', () => {
  const bone = new Object3D()
  bone.rotation.set(0.2, 0.3, 0.4)
  const clip = windClip([bone], { angle: 0 })
  for (const key of keys(clip.tracks[0])) assert.ok(lean(key, bone.quaternion) < 1e-6)
  assert.deepEqual(windClip([]).tracks, [])
})
