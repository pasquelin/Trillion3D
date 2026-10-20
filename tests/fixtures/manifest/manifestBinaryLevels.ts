// The progressive level pyramids the manifest fixtures carry (`manifestBinary.ts`,
// `manifestBinaryPreview.ts`): every byte deterministic and level-distinct.
import {
  levelBlockBytes,
  previewGeometry,
} from '../../../packages/sdk-core/src/texture/previewLevels.ts'

/** The tail of a `width`×`height` source, each level `bytesOf` its dimensions, every byte
 *  deterministic and level-distinct so a round trip that mixed up two levels would show here. */
function previewTail(
  width: number,
  height: number,
  seed: number,
  bytesOf: (w: number, h: number) => number,
) {
  return previewGeometry(width, height).sizes.map(
    ([w, h], index) =>
      new Uint8Array(bytesOf(w, h)).map(
        (_byte, i) => (i + index + seed) % 256,
      ) as Uint8Array<ArrayBuffer>,
  )
}
/** One progressive level pyramid: the lossless RGBA8 tail, and the same tail in each block
 *  family's blocks — RGBA in the BC family, two channels in ASTC and ETC2 — as the sidecar
 *  carries them. */
export function previewLevels(width: number, height: number, seed: number) {
  return {
    levels: previewTail(width, height, seed, (w, h) => w * h * 4),
    layouts: { bc7: 'rgba', astc: 'two-channel', etc2: 'two-channel' } as const,
    blocks: {
      bc7: previewTail(width, height, seed + 1, levelBlockBytes),
      astc: previewTail(width, height, seed + 2, levelBlockBytes),
      etc2: previewTail(width, height, seed + 3, levelBlockBytes),
    },
  }
}
