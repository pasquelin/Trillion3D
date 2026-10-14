// The session's root boxes pass, for a cut made alone (a test's): the stretch of each placement —
// `maxStretch` of its world, the bits the pass writes (`../../placement/gpuStretchWgsl.test.ts`) —
// into the cut's frame words (`frameTable.ts`), at its first sync and for each placement appended
// since. A move takes none: no session runs.
import { maxStretch } from '../../../../math/src/projection/projectionOracles.ts'
import type { RecordTexture } from '../core/recordTexture.ts'
import type { PackedDag } from './types.ts'
import type { RootsOnGpu } from './runtimeOps.ts'

/** Placements `[from, sources.length)`' stretches into the frame words `frames`; a slot of the
 *  room a growth keeps, no world, none. */
export function writeHostStretches(
  frames: RecordTexture,
  sources: PackedDag['worldSources'],
  from = 0,
) {
  const count = sources.length - from
  if (count <= 0) return
  const stretches = Float32Array.from({ length: count }, (_, k) => {
    const source = sources[from + k]
    return source ? maxStretch(source.world.elements) : 0
  })
  frames.write('Stretch', from, count, stretches.buffer, 0)
}

/** What a cut over `packed` made alone writes of its roots (`RootsOnGpu`): the stretches of the
 *  placements it holds, each written once. */
export function hostStretches(packed: Pick<PackedDag, 'worldSources'>): RootsOnGpu {
  let written = 0
  return {
    roots(frames) {
      writeHostStretches(frames, packed.worldSources, written)
      written = Math.max(written, packed.worldSources.length)
    },
  }
}
