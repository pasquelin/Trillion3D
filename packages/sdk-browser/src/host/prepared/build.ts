/**
 * The prepared scene, built from the cache alone: the scene tables say what it is made of, the
 * document's binary holds its vertices and embedded images — each view read by its own range on
 * its first need, never the whole binary —, and its images are read from where the tables locate
 * them.
 * No glTF is parsed and no loader runs — the host objects are made by the files beside this one,
 * each under the rules the host loader applied, so the scene is the one it built.
 */
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { DrawAssociations } from '../../page/selection/drawSource.ts'
import type { ReadRange } from '../../cluster/ranged.ts'
import { unmetered, type ByteMeter } from '../../cluster/byteMeter.ts'
import { sceneDocument } from '../../scene/tables.ts'
import { bakedImages } from '../../texture/skip.ts'
import { preparedGeometries } from './geometry.ts'
import { preparedGraph } from './graph.ts'
import { clothPrimitives } from './meshes.ts'
import { preparedImages } from './images.ts'
import { preparedMaterials } from './materials.ts'
import { preparedTextures } from './textures.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

type Inputs = {
  tables: PreparedSceneTables
  metadata: ClusterManifest
  base: string
  signal: AbortSignal | undefined
  /** Wraps each resource read, for the session's progress. */
  track: <T>(resource: string, read: Promise<T>) => Promise<T>
  /** Counts the bytes of each file read as they arrive; unset, nothing counts them. */
  meter?: ByteMeter
  /** Reads a range of a file: the page cache's (`PageCache.readRange`). */
  readRange: ReadRange
}

/** The scene, the mesh and primitive ranks each drawn host mesh answers to, the rank each host
 *  texture answers to, and how many images the cache spared. */
export async function buildPreparedScene(inputs: Inputs) {
  const { tables, metadata, base, signal, track } = inputs
  const meter = inputs.meter ?? unmetered
  const { document, documentUrl, bufferUrl } = sceneDocument(tables, base)
  // Each view of the binary is read by its own range on the first need of a host vertex or an
  // embedded image: the binary holds the whole source, most of which the cache's pages already
  // carry, and a session reads only the views it needs. Read while the scene is built (an embedded
  // image a surface samples), a view joins the load's progress, byte count and signal; read after,
  // none of them: an aborted or timed-out load signal must not refuse every later read.
  let building = true
  const binary = {
    range(offset: number, length: number) {
      if (!bufferUrl)
        return Promise.reject(
          new EngineError('PREPARED_SCENE_MISMATCH', 'the scene document names no binary'),
        )
      if (!building) return inputs.readRange(bufferUrl, offset, length)
      return track(bufferUrl, inputs.readRange(bufferUrl, offset, length, { meter, signal }))
    },
  }
  const skipped = bakedImages(metadata, document.images.length)
  const images = preparedImages({ document, documentUrl, binary, skipped, signal, track, meter })
  const ranks = new Map<Texture, number>()
  const slot = preparedTextures(tables, document, images, ranks)
  const materialOf = preparedMaterials(tables.materials, slot)
  const {
    scene,
    ranks: meshes,
    nodes,
    placed,
    clips,
  } = await preparedGraph({
    tables,
    meshes: document.meshes,
    geometryOf: preparedGeometries(document, binary),
    materialOf,
    clothOf: clothPrimitives(metadata),
  }).finally(() => {
    building = false
  })
  signal?.throwIfAborted()
  const source: Object3D = scene
  const associations: DrawAssociations = meshes
  return {
    source,
    associations,
    ranks,
    bakedImages: skipped.size,
    nodes,
    placed,
    clips,
    /** The surface of each flattened material the world's HLOD actors wear, by actor rank
     *  (`tables.hlodMaterials`): built as every surface of the scene, on a geometry with normals,
     *  texture coordinates and no colour. */
    hlodSurfaces: () =>
      Promise.all(tables.hlodMaterials.map((rank) => materialOf(rank, HLOD_VARIANT))),
  }
}

/** What an HLOD actor's mesh asks of its surface: normals and atlas coordinates, no vertex colour,
 *  its faces as its material declares them. */
const HLOD_VARIANT = { vertexColors: false, flatShading: false, twoSided: false }
