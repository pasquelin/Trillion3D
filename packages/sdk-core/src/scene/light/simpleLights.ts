import { EngineError } from '../../contracts/cache.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { SCENE_LIGHT_FLOATS, type SceneLight } from './contracts.ts'
import { LIGHT_FIELD, SIMPLE_WORD, writeLightFields, type LightLanes } from './fields.ts'

/**
 * A simple light: a light the renderer is fed for one image and the scene does not hold — a
 * particle's, an effect's. It is a point light with no shadow, no light function, no profile and no
 * source size, in every lighting channel, that lights surfaces (opaque and see-through), the
 * volumetric fog and, if asked, the translucency lighting volume; it feeds no shadow map, no
 * indirect bounce and no ray traced pass. The host hands the whole list of an image to
 * `setSimpleLights` and the list lasts until it hands another; none of it joins `SceneLightStore`'s
 * lights, so a list that changes at every image stales no cache of theirs.
 */
export interface SimpleLightEntry {
  /** Where the light is, in metres. */
  position: [number, number, number]
  /** The radius, in metres, beyond which it lights nothing. */
  radius: number
  /** The light's colour times its strength, linear RGB, three numbers of at least 0. Under the
   *  inverse square (`exponent` 0) a colour of 1 is a strength of 1e-4 candela, the scale the
   *  reference's particle lights are written in with distances in centimetres; with an
   *  `exponent`, it is a brightness scale in no unit. */
  color: [number, number, number]
  /** The exponent of the fall-off: 0, the inverse square windowed by the radius; above 0, one less the
   *  squared distance over the squared radius to that power. Absent, 0. */
  exponent?: number
  /** How much the light's strength is divided by the image's exposure, from 0 to 1
   *  (`SceneLight.inverseExposureBlend`). Absent, 0. */
  inverseExposureBlend?: number
  /** How much of the light the volumetric fog scatters, a factor of at least 0. Absent, 0: a
   *  particle light moves fast and the fog relies on a slow temporal filter. */
  volumetricScatteringIntensity?: number
  /** The factor on the light's specular light, at least 0 and not bounded above. Absent, 1. */
  specularScale?: number
  /** The factor on the light's diffuse light, at least 0 and not bounded above. Absent, 1. */
  diffuseScale?: number
  /** Whether the light is injected into the translucency lighting volume. Absent, off. */
  affectsTranslucency?: boolean
  /** Whether the sampled lighting may take the light, where a view lights with it and the setting `sampledSimpleLights` is 1. Absent, off: the
   *  classic pass lights it. */
  allowSampledLighting?: boolean
  /** Whether the sampled lighting traces a shadow ray for the light where it takes it (an entry the setting `sampledSimpleLights` hands over): the light holds no
   *  shadow map, so the ray meets the scene's geometry. Absent, off: the light casts nothing. */
  sampledCastsShadow?: boolean
  /** The light's identity from one image to the next, two whole numbers of at least 0 (the host's own: the emitter's number and the light's number in it), distinct in a list.
   *  The sampled lighting follows a light by it, in each view, across the changes of order and of count of the list, reading the history of the same light; a light with none has no history. */
  lightId?: { localId: number; sourcePrimitiveId: number }
}

/** What a light of no size and no range reaches: the reference's smallest radius, 1e-4 cm. */
const SMALLEST_RADIUS = 1e-6
/** A colour of 1 under the inverse square, in candelas: the reference scales it by the square of 100 cm a metre. */
const CANDELAS_PER_COLOUR = 1e-4

/** The slot a light that holds no shadow map has (`storeTable.ts`). */
const NO_SHADOW_SLICE = -1
/** The setting `sampledSimpleLights` as the reference has it: the lights that allow it. */
const DEFAULT_SAMPLED_MODE = 1
/** The slots the first list of lights reserves. */
const MIN_SLOTS = 8

/** The lighting channels of a simple light: all three. */
const EVERY_CHANNEL = { channel0: true, channel1: true, channel2: true } as const

const isWholeId = (value: unknown) => Number.isInteger(value) && (value as number) >= 0

/** The key a light's identity is looked up by. */
const keyOf = (entry: SimpleLightEntry) =>
  entry.lightId && `${entry.lightId.sourcePrimitiveId}:${entry.lightId.localId}`

function check(entry: SimpleLightEntry, index: number) {
  const fail = (field: string) => {
    throw new EngineError('INVALID_SCENE_LIGHT', `simple light ${index}: invalid ${field}`, {
      field,
      value: entry?.[field as keyof SimpleLightEntry],
    })
  }
  if (entry === null || typeof entry !== 'object') fail('entry')
  const triple = (value: unknown, nonNegative: boolean) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => isFiniteNumber(c) && (!nonNegative || c >= 0))
  if (!triple(entry.position, false)) fail('position')
  if (!triple(entry.color, true)) fail('color')
  if (!isFiniteNumber(entry.radius) || entry.radius < 0) fail('radius')
  for (const field of [
    'exponent',
    'volumetricScatteringIntensity',
    'specularScale',
    'diffuseScale',
  ] as const) {
    const value = entry[field]
    if (value !== undefined && !(isFiniteNumber(value) && value >= 0)) fail(field)
  }
  for (const field of [
    'affectsTranslucency',
    'allowSampledLighting',
    'sampledCastsShadow',
  ] as const)
    if (entry[field] !== undefined && typeof entry[field] !== 'boolean') fail(field)
  const id = entry.lightId
  if (id !== undefined && !(isWholeId(id?.localId) && isWholeId(id?.sourcePrimitiveId)))
    fail('lightId')
  const blend = entry.inverseExposureBlend
  if (blend !== undefined && !(isFiniteNumber(blend) && blend >= 0 && blend <= 1))
    fail('inverseExposureBlend')
}

const sameTriple = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** Whether two entries hold the same values, field by field. */
const sameEntry = (a: SimpleLightEntry, b: SimpleLightEntry) =>
  sameTriple(a.position, b.position) &&
  sameTriple(a.color, b.color) &&
  a.radius === b.radius &&
  a.exponent === b.exponent &&
  a.inverseExposureBlend === b.inverseExposureBlend &&
  a.volumetricScatteringIntensity === b.volumetricScatteringIntensity &&
  a.specularScale === b.specularScale &&
  a.diffuseScale === b.diffuseScale &&
  a.affectsTranslucency === b.affectsTranslucency &&
  a.allowSampledLighting === b.allowSampledLighting &&
  a.sampledCastsShadow === b.sampledCastsShadow &&
  a.lightId?.localId === b.lightId?.localId &&
  a.lightId?.sourcePrimitiveId === b.lightId?.sourcePrimitiveId

/** A copy the host cannot change behind the list's back. */
const snapshot = (entry: SimpleLightEntry): SimpleLightEntry => ({
  ...entry,
  position: [...entry.position],
  color: [...entry.color],
  ...(entry.lightId && { lightId: { ...entry.lightId } }),
})

/** The scene light an entry is lit as: a point light with the entry's fall-off, scales and fog share (not validated as a scene
 *  light is: its shares are not bounded above, nor its radius below). */
function recordOf(entry: SimpleLightEntry): SceneLight {
  const exponent = entry.exponent ?? 0
  const squared = exponent === 0
  return {
    id: 'simple',
    kind: 'point',
    position: entry.position,
    range: Math.max(entry.radius, SMALLEST_RADIUS),
    color: entry.color,
    intensity: squared ? CANDELAS_PER_COLOUR : 1,
    intensityUnits: 'candelas',
    inverseSquared: squared,
    ...(squared ? {} : { radialExponent: exponent }),
    diffuseShare: entry.diffuseScale ?? 1,
    specularShare: entry.specularScale ?? 1,
    inverseExposureBlend: entry.inverseExposureBlend ?? 0,
    fogScattering: entry.volumetricScatteringIntensity ?? 0,
    lightingChannels: EVERY_CHANNEL,
    castsShadow: false,
    mobility: 'movable',
    // Its light reaches no indirect bounce.
    indirectLightingIntensity: 0,
  }
}

/** Whether an entry can light anything: the reference leaves out a light whose radius and colour are both nothing. */
const lights = (entry: SimpleLightEntry) =>
  entry.radius > 1e-4 || Math.max(entry.color[0], entry.color[1], entry.color[2]) > 1e-4

/** Whether two settings views of the same kind hold the same values. */
const sameView = (held: object, view: object) =>
  Object.entries(held).every(([field, value]) => value === view[field as keyof typeof view])

/**
 * The simple lights of the image as the GPU reads them: `SCENE_LIGHT_FLOATS` a light, packed as the
 * store's lights are, with no header (`SceneLightStore.simple`). `lanes` are the store's views: a simple
 * light's kind and contact lanes are folded with them, and written again when they change (`fold`).
 */
export function createSimpleLights(lanes: Pick<LightLanes, 'contactView' | 'shadowView'>) {
  let packed = new Float32Array(0)
  let words = new Uint32Array(packed.buffer)
  let records: SceneLight[] = []
  let held = 0
  // The lit entries of the list last handed, copied: the next list is compared with them.
  let source: SimpleLightEntry[] = []
  let affects = new Uint8Array(0)
  let allowsSampled = new Uint8Array(0)
  let castsSampled = new Uint8Array(0)
  let keys: (string | undefined)[] = []
  let classic = 0
  let epoch = 0
  let allowed = true
  let hairLit = true
  let sampledMode = DEFAULT_SAMPLED_MODE
  const folded = { contactView: { ...lanes.contactView }, shadowView: { ...lanes.shadowView } }

  /** Writes the records into the table under the views' present settings. */
  function write() {
    const into = { packed, words, contactView: lanes.contactView, shadowView: lanes.shadowView }
    classic = 0
    records.forEach((record, slot) => {
      const base = slot * SCENE_LIGHT_FLOATS
      writeLightFields(into, base, record)
      // A simple light holds no shadow map: no slice, as a scene light that has none.
      packed[base + LIGHT_FIELD.shadowSlice] = NO_SHADOW_SLICE
      // Which pass lights it where a view lights with the sampled lighting: the classic one unless the setting hands it over.
      const sampledTakes = sampledMode === 2 || (sampledMode === 1 && allowsSampled[slot] === 1)
      if (!sampledTakes) classic++
      // A whole number held as the float of its value: exact, and no subnormal for a backend to flush.
      packed[base + LIGHT_FIELD.simpleWord] =
        (sampledTakes ? 0 : SIMPLE_WORD.classic) |
        (sampledTakes && castsSampled[slot] === 1 ? SIMPLE_WORD.sampledShadow : 0) |
        (affects[slot] === 1 ? SIMPLE_WORD.translucency : 0)
    })
    Object.assign(folded.contactView, lanes.contactView)
    Object.assign(folded.shadowView, lanes.shadowView)
  }
  return {
    /** Replaces the image's simple lights; entries that light nothing are left out. A list that holds what the last one did changes nothing; returns whether it did. */
    set(entries: readonly SimpleLightEntry[]) {
      entries.forEach(check)
      const seen = new Set<string>()
      for (const [index, entry] of entries.entries()) {
        const key = keyOf(entry)
        if (key === undefined) continue
        if (seen.has(key))
          throw new EngineError(
            'INVALID_SCENE_LIGHT',
            `simple light ${index}: lightId ${key} is already given to another light`,
            { field: 'lightId', value: entry.lightId },
          )
        seen.add(key)
      }
      const lit = entries.filter(lights)
      if (
        lit.length === source.length &&
        lit.every((entry, slot) => sameEntry(entry, source[slot]!))
      )
        return false
      source = lit.map(snapshot)
      if (lit.length * SCENE_LIGHT_FLOATS > packed.length) {
        packed = new Float32Array(
          grownLength(packed.length, Math.max(lit.length, MIN_SLOTS) * SCENE_LIGHT_FLOATS),
        )
        words = new Uint32Array(packed.buffer)
        affects = new Uint8Array(packed.length / SCENE_LIGHT_FLOATS)
        allowsSampled = new Uint8Array(affects.length)
        castsSampled = new Uint8Array(affects.length)
      }
      records = lit.map(recordOf)
      keys = lit.map(keyOf)
      lit.forEach((entry, slot) => {
        affects[slot] = entry.affectsTranslucency ? 1 : 0
        allowsSampled[slot] = entry.allowSampledLighting ? 1 : 0
        castsSampled[slot] = entry.sampledCastsShadow ? 1 : 0
      })
      held = lit.length
      write()
      epoch++
      return true
    },
    /** Whether the renderer takes them (the setting `allowSimpleLights`), whether hair is lit by them
     *  (`hairSimpleLights`) and which of them the sampled lighting takes (`sampledSimpleLights`): a change moves `epoch`. */
    configure(allow: boolean, hair: boolean, sampled = DEFAULT_SAMPLED_MODE) {
      if (allowed === allow && hairLit === hair && sampledMode === sampled) return
      allowed = allow
      hairLit = hair
      sampledMode = sampled
      write()
      epoch++
    },
    /** The store's views (`lanes`) were changed: writes the lights again, under a new `epoch`, if they differ from those the lights were last written under. */
    fold() {
      if (
        sameView(folded.contactView, lanes.contactView) &&
        sameView(folded.shadowView, lanes.shadowView)
      )
        return
      write()
      epoch++
    },
    /** How many simple lights the image lights: none where the renderer does not take them. */
    get count() {
      return allowed ? held : 0
    },
    /** How many of them only the classic pass lights (the sampled lighting takes the others). */
    get classicCount() {
      return allowed ? classic : 0
    },
    /** The identity of light `slot` (`SimpleLightEntry.lightId`), none for a light without one: what a view follows it by from one image to the next. */
    identityOf: (slot: number) => keys[slot],
    /** The room the buffer keeps for them: 0 until the host hands any, then the most it has handed
     *  (rounded up), never less — so a program or a buffer keyed on it changes a few times, not at every image. */
    get capacity() {
      return packed.length / SCENE_LIGHT_FLOATS
    },
    /** The lights, `SCENE_LIGHT_FLOATS` each. */
    get packed() {
      return packed
    },
    /** Whether the hair strands are lit by the simple lights. */
    get hairLit() {
      return hairLit
    },
    /** Whether light `slot` is injected into the translucency lighting volume. */
    affectsTranslucency: (slot: number) => affects[slot] === 1,
    /** Bumped at every `set` that changes the list, every change of the settings and every change of the views the lights are folded with. */
    get epoch() {
      return epoch
    },
  }
}

/** The lights a store hands to the GPU after its own. */
export type SimpleLights = ReturnType<typeof createSimpleLights>
