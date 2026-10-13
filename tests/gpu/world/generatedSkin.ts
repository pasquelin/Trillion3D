// A generated skinned model the proofs compile: a tube of three rings bent by two joints.
import { resolve } from 'node:path'
import { measureOutput } from '../../../bench/core/paths.ts'

import { compileModel, shapeSource } from './generatedShapes.ts'

/** A tube of three rings of four corners bent by two joints — the second a child of the first, one
 *  above it —, skinned, compiled: a model whose bones stand in its graph. */
export function skinnedModel(name: string, color: number[]) {
  const out = measureOutput('gpu-proofs', `append-models-${name}`)
  const source = resolve(out, 'source')
  const positions: number[] = [],
    normals: number[] = [],
    joints: number[] = [],
    weights: number[] = [],
    indices: number[] = []
  const corners = [
    [-0.3, -0.3],
    [0.3, -0.3],
    [0.3, 0.3],
    [-0.3, 0.3],
  ]
  for (let ring = 0; ring < 3; ring++)
    for (const [x, z] of corners) {
      positions.push(x, ring * 0.6, z)
      normals.push(x / 0.3 / Math.SQRT2, 0, z / 0.3 / Math.SQRT2)
      joints.push(ring === 2 ? 1 : 0, ring === 1 ? 1 : 0, 0, 0)
      weights.push(ring === 1 ? 0.5 : 1, ring === 1 ? 0.5 : 0, 0, 0)
    }
  for (let ring = 0; ring < 2; ring++)
    for (let c = 0; c < 4; c++) {
      const a = ring * 4 + c,
        b = ring * 4 + ((c + 1) % 4)
      indices.push(a, a + 4, b, b, a + 4, b + 4)
    }
  const bind = Buffer.from(
    new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.6,
      0, 1,
    ]).buffer,
  )
  shapeSource(source, { positions, normals, indices }, color, {
    attributes: { JOINTS_0: 3, WEIGHTS_0: 4 },
    accessors: [
      { bufferView: 3, componentType: 5121, type: 'VEC4', count: 12 },
      { bufferView: 4, componentType: 5126, type: 'VEC4', count: 12 },
      { bufferView: 5, componentType: 5126, type: 'MAT4', count: 2 },
    ],
    bytes: [
      Buffer.from(new Uint8Array(joints)),
      Buffer.from(new Float32Array(weights).buffer),
      bind,
    ],
    nodes: [
      { mesh: 0, skin: 0 },
      { name: 'hip', children: [2] },
      { name: 'knee', translation: [0, 0.6, 0] },
    ],
    skins: [{ joints: [1, 2], inverseBindMatrices: 5, skeleton: 1 }],
    scene: [0, 1],
  })
  return compileModel(out, source)
}
