import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'

/** A part changed by `make`, made once for a part (a part is replaced, never written). */
function remade(make: (part: CloudPart) => CloudPart) {
  const made = new WeakMap<CloudPart, CloudPart>()
  return (part: CloudPart) => {
    let changed = made.get(part)
    if (!changed) made.set(part, (changed = make(part)))
    return changed
  }
}

/** The part with its hole off. */
const withoutHole = remade((part) => ({
  ...part,
  settings: { ...part.settings, alphaHole: false },
}))

/** The part with the haze traced apart off. */
const withoutHighQualityAerial = remade((part) => ({
  ...part,
  quality: { ...part.quality, cloudHighQualityAerial: false },
}))

/**
 * The part a view draws from the part its sky has: the clouds that hold their light out (`alphaHole`) do so with
 * the alpha holdout alone (`holdout`: in effect), and a debug view of the tracing (`cloudDebugView`) has no haze
 * traced apart, the reference turning the high quality aerial perspective off there.
 */
export function drawnPartOf(part: CloudPart, holdout: boolean) {
  const held = part.settings.alphaHole && !holdout ? withoutHole(part) : part
  const { cloudDebugView, cloudHighQualityAerial } = held.quality
  return cloudDebugView !== 'none' && cloudHighQualityAerial ? withoutHighQualityAerial(held) : held
}

/** What a view's last image must have in common with the next for the next to read its history: the allocated size and the
 *  debug view (a change of view is a cut: the history holds the other view's image). */
export const cloudHistoryKey = (allocated: { width: number; height: number }, debugView: number) =>
  `${allocated.width}x${allocated.height}|${debugView}`
