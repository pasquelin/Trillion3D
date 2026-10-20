/**
 * A compile job's HLOD as a host names it — a simple form of presets, or the expert form of named
 * layers and rules — and the one function that turns either into the form the compiler reads
 * (`resolveHlod`, `HlodWire` in `compilerAbi.ts`): one path through the compiler. A job naming no
 * HLOD builds none.
 */
import type { HlodExpertOf, HlodLayer, HlodWire } from './compilerAbi.ts'
import {
  DEFAULT_HLOD_LEVELS,
  DEFAULT_HLOD_VOXEL_PIXELS,
  MAX_HLOD_LEVELS,
  MIN_HLOD_LEVELS,
} from './compilerAbi.ts'
import {
  fieldsOf as fieldsIn,
  refusal,
  wireMatch as matchIn,
  type NameMatch,
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'

/** A name to match (`NamePattern`): a string the exact name, a regular expression any name it
 *  matches — `{ regex, flags }` its JSON form, for a command line's `--hlod=`. */
export type HlodPattern = NamePattern

/** What a rule matches on what the glTF already carries (`NameMatch`). */
export type HlodMatch = NameMatch

/** The expert form: named layers and the rules assigning objects to them (`HlodExpertOf`). */
export type HlodExpert = HlodExpertOf<HlodPattern>

/** The qualities of the simple form (`HLOD_QUALITIES`). */
export type HlodQuality = 'low' | 'balanced' | 'high'
/** The simple form's quality when it names none. */
export const DEFAULT_HLOD_QUALITY: HlodQuality = 'balanced'

/** What each quality sets on every approximated layer: the deviation in pixels at the distance the
 *  layer is first seen from, and the atlas side. `balanced` is the automatic rule — one pixel,
 *  `DEFAULT_HLOD_TEXTURE_SIZE` texels. */
export const HLOD_QUALITIES: Record<
  HlodQuality,
  Pick<HlodLayer, 'deviationPixels' | 'textureSize'>
> = {
  low: { deviationPixels: 2, textureSize: 512 },
  balanced: {},
  high: { deviationPixels: 0.5, textureSize: 2048 },
}

/** The groups of the simple form, each with its own chain:
 *  - `buildings`: the main chain;
 *  - `foliage`: a short chain of two levels whose voxel is half the rule's, to keep the silhouette;
 *  - `props`: small objects, their own instanced cells absorbed by the main chain's first
 *    approximated layer.
 *  A group matching an object wins over those after it, in the order of the `groups` keys; an
 *  object no group names enters no HLOD actor, streamed and drawn in its cell alone. */
export type HlodGroup = 'buildings' | 'foliage' | 'props'
/** The groups the simple form knows. */
export const HLOD_GROUPS: readonly HlodGroup[] = ['buildings', 'foliage', 'props']

/** The simple form: how many levels the main chain has, a quality preset, and the groups of
 *  objects by name — each a node name (a string, exact) or a regular expression on it, or a
 *  `HlodMatch`. An object's mark names its group first (`HLOD_MARK`), then the first group in key
 *  order that matches it; an object neither names has no HLOD. */
export interface HlodSimple {
  /** The main chain's levels, HLOD 0 included, `MIN_HLOD_LEVELS` to `MAX_HLOD_LEVELS`.
   *  @defaultValue {@link DEFAULT_HLOD_LEVELS} */
  levels?: number
  /** The preset of every approximated layer. @defaultValue {@link DEFAULT_HLOD_QUALITY} */
  quality?: HlodQuality
  /** The objects of each group by name, for the objects no mark names. */
  groups?: Partial<Record<HlodGroup, HlodPattern | HlodMatch>>
}

/** A job's HLOD: the simple form or the expert form (`layers`), never both. Left out, the job
 *  builds no HLOD. */
export type HlodOptions = HlodSimple | HlodExpert

/** The foliage chain's voxel, in pixels: half the rule's. */
const FOLIAGE_ACCURACY_PIXELS = DEFAULT_HLOD_VOXEL_PIXELS / 2

/** The fields each form and a rule may hold. */
const SIMPLE_FIELDS = ['levels', 'quality', 'groups'] as const
const EXPERT_FIELDS = ['layers', 'assign', 'default'] as const
const ASSIGN_FIELDS = ['match', 'layer'] as const

/** A refusal of the HLOD option, in the words the host wrote. */
const refuse: Refuse = refusal('hlod')

/** `value` as an object holding only `fields`, refused in the HLOD's words otherwise. */
const fieldsOf = (value: unknown, fields: readonly string[], what: string) =>
  fieldsIn(value, fields, what, refuse)

/** A match as the compiler reads it, refused in the HLOD's words (`wireMatch`). */
const wireMatch = (match: unknown, what: string) => matchIn(match, what, refuse)

/** The chain `prefix0` … `prefix{levels - 1}`, each building the next's actors: the first
 *  instanced — the objects themselves, batched —, every coarser level approximated with
 *  `settings` — one closed shell per cell wearing its flattened material —, never merged: a merged
 *  mesh keeps every source triangle at the LOD it takes, which a far level cannot afford. */
function chain(prefix: string, levels: number, settings: Partial<HlodLayer>): HlodLayer[] {
  return Array.from({ length: levels }, (_, level) => ({
    name: `${prefix}${level}`,
    builder: level === 0 ? 'instanced' : 'approximate',
    ...(level + 1 < levels ? { parent: `${prefix}${level + 1}` } : {}),
    ...(level === 0 ? {} : settings),
  }))
}

/**
 * The HLOD the compiler reads for `options`: none when left out; the expert form as given, its
 * patterns written as the compiler reads them; the simple form as the layers and rules it stands
 * for. The forms' fields are checked here, in their own words; the
 * compiler checks the layers' names, parents and values.
 * @param options - The job's HLOD, either form, or none.
 * @returns The compiler's form (`HlodWire`), `undefined` for none.
 * @throws TypeError naming what the host wrote wrong.
 */
export function resolveHlod(options?: HlodOptions | null): HlodWire | undefined {
  // Left out or `null`: none, as the compiler reads it.
  if (options === undefined || options === null) return undefined
  if (typeof options !== 'object')
    return refuse(
      'must be the simple form { levels, quality, groups } or the expert form ' +
        '{ layers, assign, default }; leave it out for no HLOD',
    )
  if ('layers' in options) {
    const mixed = SIMPLE_FIELDS.find((field) => field in options)
    if (mixed) refuse(`${mixed} belongs to the simple form; with layers, set each layer instead`)
    fieldsOf(options, EXPERT_FIELDS, 'the expert form')
    const wire: HlodWire = { layers: options.layers }
    if (options.assign)
      wire.assign = options.assign.map((rule, at) => {
        fieldsOf(rule, ASSIGN_FIELDS, `assign[${at}]`)
        return { match: wireMatch(rule.match, `assign[${at}].match`), layer: rule.layer }
      })
    if (options.default != null) wire.default = options.default
    return wire
  }
  fieldsOf(options, SIMPLE_FIELDS, 'the simple form')
  const levels = options.levels ?? DEFAULT_HLOD_LEVELS
  if (!Number.isInteger(levels) || levels < MIN_HLOD_LEVELS || levels > MAX_HLOD_LEVELS)
    refuse(
      `levels must be a whole number from ${MIN_HLOD_LEVELS} to ${MAX_HLOD_LEVELS}, got ${levels}`,
    )
  const quality = options.quality ?? DEFAULT_HLOD_QUALITY
  if (!Object.hasOwn(HLOD_QUALITIES, quality))
    refuse(`quality must be ${Object.keys(HLOD_QUALITIES).join(', ')}, got ${String(quality)}`)
  const preset = HLOD_QUALITIES[quality]
  // Every group's chain, which a mark may name whatever the rules: the props' cells absorbed by
  // the main chain's first approximated layer.
  const layers: HlodLayer[] = [
    ...chain('hlod', levels, preset),
    ...chain('foliage', 2, { ...preset, accuracyPixels: FOLIAGE_ACCURACY_PIXELS }),
    { name: 'props0', builder: 'instanced', parent: 'hlod1' },
  ]
  const marks: Record<HlodGroup, string> = {
    buildings: 'hlod0',
    foliage: 'foliage0',
    props: 'props0',
  }
  const groups = fieldsOf(options.groups ?? {}, HLOD_GROUPS, 'groups')
  const assign = Object.entries(groups).map(([group, match]) => ({
    match: wireMatch(match, `groups.${group}`),
    layer: marks[group as HlodGroup],
  }))
  return { layers, assign, marks }
}
