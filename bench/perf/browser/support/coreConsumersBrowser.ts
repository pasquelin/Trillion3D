// First part of the foundation bench, `sdk-browser` consumers: each computation attached to
// the foundation, opposed to the host-library code it replaces, copied in `oracles/socle-math*.ts`.
// A single different value and the line fails: the attachment changes no bit.
import * as THREE from 'three'
import { srgbToLinear } from '../../../../packages/sdk-core/src/index.ts'
import { linearToSrgb8 } from '../../../../packages/sdk-core/src/math/primitives/color.ts'
import { projectVisibilityVertex } from '../../../../packages/sdk-browser/src/visibility/projection.ts'
import {
  setWindingEpoch,
  windingCw,
} from '../../../../packages/sdk-browser/src/webgpu/pages/render/winding.ts'
import { noteResidenceChange } from '../../../../packages/sdk-browser/src/webgpu/shadow/bounds.ts'
import { createWebgpuLightState } from '../../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import * as ancien from '../../../oracles/browser/core-math.ts'
import { SPHERE_FLOATS, referenceClusterSphere } from '../../../oracles/browser/lamp-shadows.ts'
import { affines, matrices, points } from './scenesCore.ts'
import { enregistrements, octets } from './scenesCoreConsumers.ts'
import { ligne } from './coreLine.ts'
import { parElement } from '../../../core/index.ts'

// One light, so `store.count` holds and `noteResidenceChange` actually notes a change; its
// change list's `representationChanged` is replaced per case below to capture the bounds it is
// called with, instead of applying them.
const lumieres = createWebgpuLightState()
lumieres.store.add({
  id: 'l0',
  kind: 'point',
  position: [0, 0, 0],
  color: [1, 1, 1],
  intensity: 100,
  range: 20,
  castsShadow: true,
})

export async function lignesConsommateursBrowser() {
  const { list, roots, ranks } = enregistrements
  // Each record is placed by its original rank.
  const rootOfPacked = Int32Array.from({ length: roots.length }, (_, i) => i)
  const hostileRoots = matrices.map((e) => ({ world: new THREE.Matrix4().fromArray(e) }))
  const attribut = new THREE.BufferAttribute(Float32Array.from(points.flat()), 3)
  // The compared subject is the projection of a vertex, not the read of a convention: the
  // view-projection/convention pairs are built once, outside the measured loops.
  const projectedViews = matrices.map((e) => ({ viewProjection: e }))
  // The engine side's inputs and outputs, built once and never under the clock: each vertex's
  // model matrix and rank, each case's box, each sRGB pair.
  const modeles = affines.slice(0, 60).map((m) => new THREE.Matrix4().fromArray(m))
  const vertices = modeles.flatMap((_, i) => points.slice(0, 40).map((_, v) => [i, v] as const))
  const boxes = list.map((): number[] => []),
    encodages = octets.map(() => [0, 0])
  // Built once, so the timed call reuses its output array instead of building one.
  const projected = parElement(([i, v]: readonly [number, number]) =>
    projectVisibilityVertex(
      modeles[i],
      attribut,
      v,
      projectedViews[(i * 11) % projectedViews.length],
      1280,
      720,
    ),
  )
  let target: number[] = []
  Object.assign(lumieres.changes, {
    representationChanged: (min: ArrayLike<number>, max: ArrayLike<number>) =>
      void target.push(min[0], min[1], min[2], max[0], max[1], max[2]),
  })
  return [
    await ligne(
      'world-space cluster sphere for shadows',
      'packages/sdk-browser/src/webgpu/shadow/bounds.ts',
      'poses × boxes',
      list,
      (l) =>
        l.map((r) => {
          // The split-double sphere: centre = high + low, conservative radius.
          const s = new Float32Array(SPHERE_FLOATS)
          referenceClusterSphere(r, s, 0)
          const [x, y, z, rayon] = [s[0] + s[4], s[1] + s[5], s[2] + s[6], s[3]]
          return [x - rayon, y - rayon, z - rayon, x + rayon, y + rayon, z + rayon]
        }),
      parElement((r: (typeof list)[number], i) => {
        target = boxes[i]
        target.length = 0
        noteResidenceChange(lumieres, roots, rootOfPacked, ranks.get(r) ?? 0, r)
        return target
      }),
    ),
    await ligne(
      'winding order of a cluster',
      'packages/sdk-browser/src/webgpu/pages/render/winding.ts',
      'hostile matrices',
      matrices,
      (l) => l.map((e) => ancien.referenceWindingCw(e)),
      parElement((_: Float64Array, i) => {
        setWindingEpoch(i + 1)
        return windingCw(hostileRoots, i)
      }),
    ),
    await ligne(
      'projected vertex of the visibility buffer',
      'packages/sdk-browser/src/visibility/projection.ts',
      'poses × view-projections × vertices',
      affines.slice(0, 60),
      (l) =>
        l.flatMap((m, i) =>
          points
            .slice(0, 40)
            .map((_, v) =>
              ancien.referenceProjectVisibilityVertex(
                new THREE.Matrix4().fromArray(m),
                attribut,
                v,
                new THREE.Matrix4().fromArray(matrices[(i * 11) % matrices.length]),
                1280,
                720,
              ),
            ),
        ),
      () => projected(vertices),
    ),
    await ligne(
      'sRGB: byte table and 8-bit encoding',
      'packages/sdk-core/src/math/primitives/color.ts',
      '256 bytes and hostile values',
      octets,
      (l) =>
        l.map((c, i) => [ancien.referenceSrgb8Linear(i % 256), ancien.referenceLinearToSrgb8(c)]),
      parElement((c: number, i) => {
        const sortie = encodages[i]
        ;[sortie[0], sortie[1]] = [srgbToLinear((i % 256) / 255), linearToSrgb8(c)]
        return sortie
      }),
    ),
  ]
}
