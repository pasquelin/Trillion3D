// A proof scene's clusters given the quantized geometry pages a compiler writes
// (`packages/page-codec/src/geometryPage.ts`): each page of the scene's manifest names its page,
// encoded from its triangle and the mesh's positions, normals and texture coordinates — the second
// set too, as `TEXCOORD_1` —, and the engine reads it through `readGeometryPage`, decoding every
// attribute in place on the GPU instead of the float pool.
import { encodeGeometryPage } from '../../../packages/page-codec/src/geometryPage.ts'
import type { PageAttributes } from '../../../packages/page-codec/src/pageAttributes.ts'
import type { ScenePreparee } from '../kit/sharedSceneProof.ts'

/** The glTF semantic of each host attribute a page carries. */
const SEMANTICS = [
  ['position', 'POSITION'],
  ['normal', 'NORMAL'],
  ['uv', 'TEXCOORD_0'],
  ['uv1', 'TEXCOORD_1'],
] as const
/** A position grid of 1/1024 unit, under any error a proof reads. */
const POSITION_EXPONENT = -10

/** Gives every page of `scene` its geometry page, and returns the reader that serves them. */
export function compilePages(scene: ScenePreparee) {
  const bytes = new Map<string, Uint8Array>()
  for (const primitive of scene.metadata.primitives) {
    const attributes = scene.geometries[primitive.mesh].attributes
    const source: PageAttributes = {}
    for (const [name, semantic] of SEMANTICS) {
      const list = attributes[name]
      if (list) source[semantic] = { itemSize: list.itemSize, array: new Float32Array(list.array) }
    }
    primitive.quantization = {
      positionExponent: POSITION_EXPONENT,
      uvExponent: -14,
      maxPositionError: 2 ** POSITION_EXPONENT,
    }
    for (const page of primitive.pages) {
      const encoded = encodeGeometryPage(scene.indices.get(page.url)!, source, POSITION_EXPONENT)
      const url = `geometry-${page.url}`
      bytes.set(url, encoded.data)
      page.geometry = {
        url,
        sha256: 'proof',
        bytes: encoded.data.byteLength,
        vertexCount: encoded.vertexCount,
        indexCount: encoded.indexCount,
        flags: encoded.flags,
        uncompressedBytes: encoded.uncompressedBytes,
      }
    }
  }
  return async (url: string) => bytes.get(url)!
}
