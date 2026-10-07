/** The checks and writes the test encoder applies before it stores a row, as the compiler refuses
 *  them (`asset-compiler-rust/src/manifest_binary/page.rs`). */
import {
  EngineError,
  type ClusterManifest,
  type Page,
} from '../../../packages/sdk-core/src/contracts/index.ts'
import { PREVIEW_BLOCK_FORMATS } from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'
import type { Counts } from '../../../packages/sdk-core/src/manifest/binaryLayout.ts'
import type { SlimPrimitiveBinary } from '../../../packages/sdk-core/src/manifest/binaryTypes.ts'
import { MAX_DEPTH_LAYER } from '../../../packages/sdk-core/src/lod/depthLayer.ts'
import {
  previewBlockBytes,
  previewGeometry,
} from '../../../packages/sdk-core/src/texture/previewLevels.ts'

/** A cluster's coplanar depth layer, refused unless it fits the four bits the cache gives it. */
export function checkedDepthLayer(depthLayer: number) {
  if (!Number.isInteger(depthLayer) || depthLayer < 0 || depthLayer > MAX_DEPTH_LAYER)
    throw new EngineError('INVALID_CACHE', 'A cluster depth layer does not fit four bits', {
      depthLayer,
    })
  return depthLayer
}

/** Writes page `page`'s cone into the cone column: three finite axis numbers and a finite angle,
 *  as the compiler requires. Only an absent cone is open (a hand-written page); a `null` or
 *  malformed one is refused, never read as open nor thrown as a `TypeError`. */
export function writeCone(
  column: Float64Array,
  page: number,
  cone: Page['cone'] | null = { axis: [0, 0, 1], angle: Math.PI },
) {
  const axis: unknown = cone?.axis
  // `Array.from` turns a hole into `undefined`, which `every` alone would skip and `set` write as NaN.
  if (!Array.isArray(axis) || axis.length !== 3 || !Array.from(axis).every(Number.isFinite))
    throw new EngineError('INVALID_CACHE', 'A cluster cone is not three axis numbers', { cone })
  if (!Number.isFinite(cone!.angle))
    throw new EngineError('INVALID_CACHE', 'A cluster cone angle is not finite', { cone })
  column.set(axis as number[], page * 4)
  column[page * 4 + 3] = cone!.angle
}

/** A digest as its 64 ASCII hexadecimal characters, at its slot in a sha column; nothing is
 *  written if it is not 64 lowercase hexadecimal characters. */
export function writeSha(target: Uint8Array, slot: number, sha: string) {
  if (!/^[0-9a-f]{64}$/.test(sha))
    throw new EngineError(
      'INVALID_CACHE',
      'A cache object digest is not 64 lowercase hexadecimal characters',
      { sha256: sha },
    )
  for (let i = 0; i < 64; i++) target[slot * 64 + i] = sha.charCodeAt(i)
}
/** Every object url a sidecar names follows its template; a cache where one does not is rejected. */
export function expectTemplate(template: string, url: string, sha: string) {
  if (template.replace('{sha}', sha) !== url)
    throw new EngineError(
      'INVALID_CACHE',
      'A cache object url does not follow the manifest template',
      {
        url,
        template,
      },
    )
}

export function countManifest(manifest: ClusterManifest): Counts {
  const previews = manifest.texturePreviews ?? []
  const counts: Counts = {
    pages: 0,
    cullingNodes: 0,
    groups: 0,
    children: 0,
    outputs: 0,
    roots: 0,
    bundles: 0,
    bundleDependencies: 0,
    previews: previews.length,
    previewBytes: previews.reduce(
      (bytes, preview) => bytes + previewGeometry(preview.width, preview.height).pixelBytes,
      0,
    ),
    previewBlockBytes: { bc7: 0, astc: 0, etc2: 0 },
  }
  for (const preview of previews)
    for (const name of PREVIEW_BLOCK_FORMATS)
      if (preview.layouts[name] !== 'lossless')
        counts.previewBlockBytes[name] += previewBlockBytes(preview.width, preview.height)
  for (const primitive of manifest.primitives) {
    counts.pages += primitive.pages.length
    counts.cullingNodes += primitive.culling?.count ?? 0
    for (const group of primitive.structure?.groups ?? []) {
      counts.groups++
      counts.children += group.children.length
      counts.outputs += group.outputs.length
    }
    counts.roots += primitive.structure?.roots.length ?? 0
    for (const bundle of primitive.streams?.pages ?? []) {
      counts.bundles++
      counts.bundleDependencies += bundle.dependencies.length
    }
  }
  return counts
}

/** The counts and constants a primitive needs to find its own slice of every column. */
export function slimBinaryOf(primitive: {
  pages: { length: number }
  culling?: { stride: number; count: number } | null
  structure?: { version: number; groups: { length: number }; roots: { length: number } } | null
  streams?: {
    version: number
    pinned: number
    bundleBytes: number
    dependencyBound: number
    maxDependencies: number
    pages: { length: number }
  } | null
}): SlimPrimitiveBinary {
  const slim: SlimPrimitiveBinary = { pages: primitive.pages.length }
  if (primitive.culling !== undefined)
    slim.culling =
      primitive.culling === null
        ? null
        : { stride: primitive.culling.stride, count: primitive.culling.count }
  if (primitive.structure !== undefined)
    slim.structure =
      primitive.structure === null
        ? null
        : {
            version: primitive.structure.version,
            groups: primitive.structure.groups.length,
            roots: primitive.structure.roots.length,
          }
  if (primitive.streams !== undefined)
    slim.streams =
      primitive.streams === null
        ? null
        : {
            version: primitive.streams.version,
            pinned: primitive.streams.pinned,
            bundleBytes: primitive.streams.bundleBytes,
            dependencyBound: primitive.streams.dependencyBound,
            maxDependencies: primitive.streams.maxDependencies,
            pages: primitive.streams.pages.length,
          }
  return slim
}
