// Inputs of consumers attached to the foundation: cluster records, colours. Drawn from a seed.
import * as THREE from 'three'
import { xorshiftRandom } from '../../../core/index.ts'
import { affines, bordDe, matrices } from './scenesCore.ts'
import { pageRecFixture } from './pageRecFixture.ts'
import type { PageRec } from '../../../../packages/sdk-browser/src/page/selection/types.ts'

const alea = xorshiftRandom(0xc0de5)
const bord = bordDe(alea)

/** Cluster records: hostile poses and matrices, spheres and boxes. */
const errors: (number | null | undefined)[] = [0, 0.5, 2, Infinity, null, undefined]
/** Each record with the world the oracles read on it, the one its root carries for the engine. */
const list: (PageRec & { matrix: THREE.Matrix4 })[] = [],
  roots: { world: THREE.Matrix4 }[] = [],
  /** Each record's original rank: the batch walk reads its placement through this. */
  ranks = new Map<PageRec, number>()
for (let i = 0; i < 900; i++) {
  const fini = i % 3 !== 0
  const source = fini ? affines[i % affines.length] : matrices[i % matrices.length]
  const c = [alea() * 40 - 20, alea() * 40 - 20, alea() * 40 - 20],
    r = alea() * 3
  const sphere = i % 7 === 0 ? undefined : [...c, r]
  const matrix = new THREE.Matrix4().fromArray(source)
  roots.push({ world: matrix })
  const record = {
    matrix,
    ...pageRecFixture({
      url: `c${i}`,
      streamUrl: i % 5 === 0 ? `b${i % 40}` : undefined,
      min: [c[0] - r, c[1] - r, c[2] - r],
      max: [c[0] + r, c[1] + r, c[2] + r],
      lodError: errors[i % errors.length] ?? 0,
      sphere,
      parentError: i % 4 === 0 ? null : errors[(i >> 1) % errors.length],
      parentSphere: i % 6 === 0 ? null : sphere,
      array: i % 50 === 0 ? new Uint32Array(1) : undefined,
    }),
  }
  list.push(record)
  ranks.set(record, i)
}
export const enregistrements = {
  list,
  roots,
  ranks,
}

/** Linear values 8-bit encoding receives, including boundary values. */
export const octets: number[] = []
for (let i = 0; i < 1024; i++) octets.push(i % 11 === 0 ? bord() : alea() * 1.2 - 0.1)
