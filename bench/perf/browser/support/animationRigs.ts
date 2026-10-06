// The scene of the animation benches (`animation-sampler.perf.ts`, `animation-worker.perf.ts`): 400
// rigs of 25 bones, each bone a position and a rotation track of 31 linear keys, one clip played by
// every rig on both sides, so a frame samples, blends and writes 20 000 tracks on 10 000 nodes.
import * as THREE from 'three'
import { Object3D } from '../../../../packages/sdk-core/src/world/object/object3d.ts'
import { Mixer } from '../../../../packages/sdk-core/src/world/animation/mixer.ts'
import type { Clip, Track } from '../../../../packages/sdk-core/src/world/animation/clip.ts'
import { quaternion, rnd } from '../../../oracles/core/three-duel.ts'

const RIGS = 400,
  BONES = 25,
  KEYS = 31
export const NODES = RIGS * BONES
/** One frame of the loop: both sides advance by it, so after the same number of calls both stand
 *  at the same clip time and the oracle compares like with like. */
export const FRAME = 1 / 60

const times = Float32Array.from({ length: KEYS }, (_, k) => k / (KEYS - 1))
/** Bone `b`'s two tracks: a wandering position and a turning rotation, keys drawn once. */
function boneTracks(b: number) {
  const positions = Float32Array.from({ length: KEYS * 3 }, () => rnd(-2, 2))
  const rotations = new Float32Array(KEYS * 4)
  for (let k = 0; k < KEYS; k++) quaternion().toArray(rotations, k * 4)
  return [
    { name: `b${b}.position`, kind: 'vector', times, values: positions },
    { name: `b${b}.quaternion`, kind: 'quaternion', times, values: rotations },
  ] satisfies Track[]
}
const tracks = Array.from({ length: BONES }, (_, b) => boneTracks(b)).flat()
const clip: Clip = { name: 'walk', duration: 1, tracks }
const clipThree = new THREE.AnimationClip(
  'walk',
  1,
  tracks.map((t) =>
    t.kind === 'quaternion'
      ? new THREE.QuaternionKeyframeTrack(t.name, t.times, t.values)
      : new THREE.VectorKeyframeTrack(t.name, t.times, t.values),
  ),
)

/** The two scenes, built once the samplers are lent: one root per rig under the scene, its bones
 *  named as the tracks address them, each rig playing the clip on both sides. */
export function animationRigs() {
  const scene = new Object3D(),
    sceneThree = new THREE.Object3D()
  const bones: Object3D[] = [],
    bonesThree: THREE.Object3D[] = [],
    mixersThree: THREE.AnimationMixer[] = []
  for (let r = 0; r < RIGS; r++) {
    const root = new Object3D(),
      rootThree = new THREE.Object3D()
    scene.add(root)
    sceneThree.add(rootThree)
    for (let b = 0; b < BONES; b++) {
      const bone = new Object3D(),
        boneThree = new THREE.Object3D()
      bone.name = boneThree.name = `b${b}`
      root.add(bone)
      rootThree.add(boneThree)
      bones.push(bone)
      bonesThree.push(boneThree)
    }
    new Mixer(root).play(clip)
    const mixer = new THREE.AnimationMixer(rootThree)
    mixer.clipAction(clipThree).play()
    mixersThree.push(mixer)
  }
  return { scene, bones, bonesThree, mixersThree }
}
