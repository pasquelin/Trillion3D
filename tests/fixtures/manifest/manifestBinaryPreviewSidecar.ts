// The preview tests' sidecar bench: a manifest of previews encoded, its preview words reachable on
// the finished buffer, and the refusal a lying sidecar must meet.
import assert from 'node:assert/strict'
import { TEMPLATES, sha } from './manifestBinary.ts'
import { decodeManifestBinary } from '../../../packages/sdk-core/src/manifest/binaryDecode.ts'
import { encodeManifestBinary } from './manifestBinaryEncode.ts'
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  EngineError,
  type ClusterManifest,
  type TexturePreview,
} from '../../../packages/sdk-core/src/contracts/index.ts'
import {
  COLUMN_NAMES,
  MANIFEST_BINARY_HEADER_WORDS,
  PREVIEW_WORDS,
} from '../../../packages/sdk-core/src/manifest/binaryFormat.ts'

function manifestWith(previews: TexturePreview[]): ClusterManifest {
  return {
    schema: CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: 'k',
    scope: 'full',
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    primitives: [],
    texturePreviews: previews,
  } as ClusterManifest
}
/** `previews` encoded into a slim manifest and its sidecar buffer. */
export function encode(previews: TexturePreview[]) {
  const { manifest: slim, binary } = encodeManifestBinary(manifestWith(previews), TEMPLATES)
  slim.binary.sha256 = sha('f')
  // `encodeManifestBinary` always backs the view with a plain `ArrayBuffer`; `.buffer` types as
  // the wider `ArrayBufferLike`.
  const buffer = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  ) as ArrayBuffer
  return { slim, buffer }
}
/** The `texturePreviewU32` words of entry `entry`, on the finished buffer: the only way to
 *  build a sidecar whose geometry or byte range lies without going through the encoder, which
 *  would reject it itself. */
export function previewWord(buffer: ArrayBuffer, entry: number, field: number) {
  const header = new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2)
  const index = COLUMN_NAMES.indexOf('texturePreviewU32')
  const offset = header[MANIFEST_BINARY_HEADER_WORDS + index * 2]
  return new Uint32Array(buffer, offset + (entry * PREVIEW_WORDS + field) * 4, 1)
}
// Word ranks, hardcoded here rather than imported: the tests freeze the sidecar layout.
export const PREVIEW_FIRST_LEVEL = 6,
  PREVIEW_PIXEL_OFFSET = 8,
  PREVIEW_PIXEL_BYTES = 9,
  PREVIEW_ATLAS = 10,
  PREVIEW_BAKED_LEVELS = 11,
  PREVIEW_LAYOUTS = 12
/** The sidecar is refused as an invalid cache, never read. */
export function refused(buffer: ArrayBuffer, slim: Parameters<typeof decodeManifestBinary>[0]) {
  assert.throws(
    () => decodeManifestBinary(slim, buffer),
    (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  )
}
