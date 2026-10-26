import { EngineError } from '../../contracts/cache.ts'
import { LIGHT_HEADER_FORWARD, type SceneLight } from './contracts.ts'
import { brightnessOf, forwardShadingPriorityOf, lightColour } from './fields.ts'

/**
 * THE DIRECTIONAL LIGHT THE FORWARD READERS TAKE: of the directional lights of a scene one is
 * chosen for the readers that take a single one — the translucent surfaces' shade from the clouds,
 * the volumetric fog's light. The chosen light is the one of the highest `forwardShadingPriority`;
 * of equal priorities, the one whose declared colour times its brightness has the greatest squared
 * length — before the air tints it, so a sun reddened at the horizon keeps its place —, the first
 * added of equals (`lightRanks.ts`). The choice is made again when a directional light is added,
 * changed or removed, and read as an id, so a light that moves to another slot stays the one.
 */

/** The squared length of a light's colour (with its temperature) times its brightness: what the
 *  choice compares among equal priorities. */
function forwardBrightness(light: SceneLight) {
  const [r, g, b] = lightColour(light)
  const s = brightnessOf(light)
  return (r * r + g * g + b * b) * s * s
}

/** The priority of a directional light into `validated` where named: a whole number of at least 0,
 *  refused on any other kind of light. */
export function validateForwardShadingPriority(light: SceneLight, validated: SceneLight) {
  const { id, kind, forwardShadingPriority: priority } = light
  if (priority === undefined) return
  if (kind !== 'directional')
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: forwardShadingPriority exists only for a directional light`,
      { forwardShadingPriority: priority },
    )
  if (!Number.isInteger(priority) || priority < 0)
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${id}: forwardShadingPriority expects a whole number of at least 0`,
      { forwardShadingPriority: priority },
    )
  validated.forwardShadingPriority = priority
}

/** The id of the light the forward readers take among the directional lights of `ids` (their
 *  `records`, `rankOf` their order of adding), none without one. */
function chooseForwardDirectional(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
) {
  let best: string | undefined,
    priority = -1,
    brightness = 0,
    rank = Infinity
  for (const id of ids) {
    const light = records.get(id)!
    if (light.kind !== 'directional') continue
    const p = forwardShadingPriorityOf(light),
      b = forwardBrightness(light),
      at = rankOf(id)
    if (p > priority || (p === priority && (b > brightness || (b === brightness && at < rank)))) {
      best = id
      priority = p
      brightness = b
      rank = at
    }
  }
  return best
}

/** The chosen light of a store, made again at the next read after a directional light was added,
 *  changed or removed (`stale`). */
function createForwardLight(
  ids: readonly string[],
  records: ReadonlyMap<string, SceneLight>,
  rankOf: (id: string) => number,
) {
  let chosen: string | undefined,
    stale = true
  return {
    /** The id of the light chosen, none without a directional light. */
    get id() {
      if (stale) {
        chosen = chooseForwardDirectional(ids, records, rankOf)
        stale = false
      }
      return chosen
    },
    /** A directional light was added, changed or removed. */
    changed() {
      stale = true
    },
  }
}

/** What the forward light's header word reads of a light store. */
interface ForwardSources {
  readonly ids: readonly string[]
  readonly records: ReadonlyMap<string, SceneLight>
  readonly indexOf: ReadonlyMap<string, number>
  readonly rankOf: (id: string) => number
  /** The buffer's header, over the packed lights' first words: a new view when the table grows. */
  readonly header: () => Uint32Array
}

/**
 * The forward light of a store and the header word that names its slot, one more than the slot (0
 * for none): chosen again and written when a directional light is added, changed or removed
 * (`changed`), written alone when the slots moved under a light that is not one (`moved`).
 */
export function createForwardHeader(sources: ForwardSources) {
  const forward = createForwardLight(sources.ids, sources.records, sources.rankOf)
  const slot = () => (forward.id === undefined ? undefined : sources.indexOf.get(forward.id)) ?? -1
  const write = () => {
    sources.header()[LIGHT_HEADER_FORWARD] = slot() + 1
  }
  return {
    /** The slot of the light chosen, −1 without one. */
    get slot() {
      return slot()
    },
    /** A directional light was added, changed or removed: the choice is made again, the word written. */
    changed() {
      forward.changed()
      write()
    },
    /** The slots moved: the word is written again, the choice stays. */
    moved: write,
  }
}
