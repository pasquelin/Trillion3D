// The scene a world's session opens on (`buildWorldSource`): every compiled model's primitives in the session's manifest, the page's
// shapes after them.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createWorldBatches } from './batches.ts'
import { createWorldMaterials } from './materials/materials.ts'
import { createWorldRanks } from './ranks.ts'
import { createWorldModels } from './models/models.ts'
import { LoadedModel, type ModelRecord } from './models/loadedModel.ts'
import { buildWorldSource } from './source.ts'
import type { Cut } from './cuts.ts'

/** A compiled model of `primitives` primitives, read from `folder`. */
function compiled(folder: string, primitives: number) {
  const base = `http://localhost/${folder}/`
  const metadata = {
    primitives: Array.from({ length: primitives }, (_, mesh) => ({
      mesh,
      primitive: 0,
      pages: [],
    })),
  } as unknown as ClusterManifest
  const record = {
    ...{ manifestUrl: base, metadataUrl: base, base, metadata },
    scene: {
      ...{ source: new Group(), associations: new Map(), draws: [], textureCaches: [] },
      ...{ partitions: [], nodes: null, clips: [], banks: null, framingLot: null },
    },
  } as unknown as ModelRecord
  return new LoadedModel(record)
}

/** The site's flag as a world draws it — its compiled model, a lawn, a pole and a cloth —, a second compiled model of two
 *  primitives, and the page's box, cylinder and sphere, each a cut of its own. */
function flagWorld(models: LoadedModel[]) {
  const paint = material.meshStandard({ color: 0xc23b3b })
  const materials = createWorldMaterials(),
    ranks = createWorldRanks(),
    entry = materials.entryOf(paint)
  const batches = createWorldBatches(
    () => {},
    (worn, held, twoSided) => materials.surfaceOf(worn, held.drawn, twoSided),
    ranks,
  )
  for (const key of ['box', 'cylinder', 'sphere']) {
    const shape = {
      ...{ key, users: new Set(), held: false },
      drawn: {
        ...{ positions: new Float32Array(9), normals: new Float32Array(9), uvs: null },
        ...{ colors: null, indices: new Uint32Array([0, 1, 2]) },
      },
      runtime: { primitive: { pages: [] }, urls: [] },
    } as unknown as Cut
    batches.seat(new Mesh(new Geometry(), paint), shape, entry)
  }
  const build = () =>
    buildWorldSource({
      ...{ batches: batches.reopen(), models, ranks },
      worldModels: createWorldModels(ranks),
    })!
  return { build }
}

test('the session’s manifest lists each compiled model’s primitives, the page’s shapes after them', () => {
  const { build } = flagWorld([compiled('flag', 3), compiled('crates', 2)])
  const { metadata } = build().source
  assert.equal(
    metadata.primitives.length,
    8,
    'three of the flag, two of the crates, three of the page',
  )
})
