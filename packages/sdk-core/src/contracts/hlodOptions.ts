/**
 * A compile job's HLOD as a host names it — a simple form of levels and groups, or the expert form
 * of named layers and rules — and the one function that turns either into the form the compiler reads
 * (`resolveHlod`, `HlodWire` in `hlodLayerAbi.ts`): one path through the compiler. A job naming no
 * HLOD builds none.
 */
import type { HlodExpertOf, HlodLayer, HlodWire } from './compilerAbi.ts'
import {
  DEFAULT_HLOD_CELL_SIZE,
  DEFAULT_HLOD_LEVELS,
  DEFAULT_HLOD_LOADING_RANGE,
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

/** The groups of the simple form, each with its own chain, every chain's grid doubling its cell
 *  and its range level after level from `DEFAULT_HLOD_CELL_SIZE` and `DEFAULT_HLOD_LOADING_RANGE`:
 *  - `buildings`: the main chain — the objects themselves, then one merged level after another
 *    (`MERGED_LAYER`) —, its last level always loaded;
 *  - `foliage`: a short chain of two levels — the objects themselves, then one `voxel` actor per
 *    HLOD 0 cell, the cell's objects voxelized together: no shell, no atlas, a leaf's cut-out
 *    kept, the cut picking each brick level by its error —, those actors its top, always loaded
 *    (`src/hlod/cells.rs`); its objects' meshes are voxelized far away too
 *    (`voxelizeOptions.ts`);
 *  - `props`: small objects, their own instanced cells absorbed by the main chain's first merged
 *    layer — a main chain of one level has none: the props then stay always loaded.
 *  A group matching an object wins over those after it, in the order of the `groups` keys; an
 *  object no group names enters the `default` group's chain. */
export type HlodGroup = 'buildings' | 'foliage' | 'props'
/** The groups the simple form knows. */
export const HLOD_GROUPS: readonly HlodGroup[] = ['buildings', 'foliage', 'props']
/** The group of an object neither a mark nor a group names, when the simple form names none: the
 *  main chain, as a world's default layer takes any object no layer names. */
export const DEFAULT_HLOD_GROUP: HlodGroup = 'buildings'

/** The simple form: how many levels the main chain has, the groups of objects by name — each a
 *  node name (a string, exact) or a regular expression on it, or a `HlodMatch` — and the group of
 *  the others. An object's mark names its group first (`HLOD_MARK`), then the first group in key
 *  order that matches it, then `default`; an object whose node's `extras` say
 *  `HLOD_INCLUDE_MARK: false` enters none, and one that says `HLOD_INSTANCE_MARK: true` stands as
 *  itself in every actor its chain builds. */
export interface HlodSimple {
  /** The main chain's levels, HLOD 0 included, `MIN_HLOD_LEVELS` to `MAX_HLOD_LEVELS`: the first
   *  instanced, every other merged (`MERGED_LAYER`); one level is the objects themselves, instanced
   *  and always loaded.
   *  @defaultValue {@link DEFAULT_HLOD_LEVELS} */
  levels?: number
  /** The objects of each group by name, for the objects no mark names. */
  groups?: Partial<Record<HlodGroup, HlodPattern | HlodMatch>>
  /** The group of an object neither a mark nor a group names; `'none'` leaves it out of every
   *  HLOD actor — drawn in its cell alone, nothing standing for it past that cell's range.
   *  @defaultValue {@link DEFAULT_HLOD_GROUP} */
  default?: HlodGroup | 'none'
}

/** A job's HLOD: the simple form or the expert form (`layers`), never both. Left out, the job
 *  builds no HLOD. */
export type HlodOptions = HlodSimple | HlodExpert

/** The fields each form and a rule may hold: `default` either form's. */
const SIMPLE_FIELDS = ['levels', 'groups', 'default'] as const
const EXPERT_FIELDS = ['layers', 'assign', 'default'] as const
const ASSIGN_FIELDS = ['match', 'layer'] as const

/** A refusal of the HLOD option, in the words the host wrote. */
const refuse: Refuse = /* @__PURE__ */ refusal('hlod')

/** `value` as an object holding only `fields`, refused in the HLOD's words otherwise. */
const fieldsOf = (value: unknown, fields: readonly string[], what: string) =>
  fieldsIn(value, fields, what, refuse)

/** A match as the compiler reads it, refused in the HLOD's words (`wireMatch`). */
const wireMatch = (match: unknown, what: string) => matchIn(match, what, refuse)

/** The grid of a chain's level `level`: the default cell and range doubled at each level. */
const gridOf = (level: number): Pick<HlodLayer, 'cellSize' | 'loadingRange'> => ({
  cellSize: DEFAULT_HLOD_CELL_SIZE * 2 ** level,
  loadingRange: DEFAULT_HLOD_LOADING_RANGE * 2 ** level,
})

/** The settings of every merged layer of the simple form's main chain: the reference's default
 *  merged layer. The LOD of each source is its lowest, the materials merge into one atlas sized by
 *  the distance its actor is first drawn, no flattened material draws both faces, and the normal,
 *  roughness, metallic, specular and emissive images are baked beside the base colour; every other
 *  setting is its default. */
const MERGED_LAYER: Partial<HlodLayer> = {
  lodSelection: 'lowest',
  mergeMaterials: true,
  textureSizing: 'drawDistance',
  allowDoubleSided: false,
  maps: { normal: true, roughness: true, metallic: true, specular: true, emissive: true },
}

/** The chain `prefix0` … `prefix{levels - 1}`, each building the next's actors on a grid twice as
 *  coarse (`gridOf`), the last always loaded: the first instanced — the objects themselves,
 *  batched —, every coarser level merged with `MERGED_LAYER` — one mesh per cell, its objects at
 *  their lowest LOD wearing one atlas. */
function chain(prefix: string, levels: number): HlodLayer[] {
  return Array.from({ length: levels }, (_, level) => ({
    name: `${prefix}${level}`,
    builder: level === 0 ? 'instanced' : 'merge',
    ...(level + 1 < levels
      ? { parent: `${prefix}${level + 1}`, ...gridOf(level) }
      : { spatiallyLoaded: false }),
    ...(level === 0 ? {} : MERGED_LAYER),
  }))
}

/** The props' chain: one instanced layer whose cells the main chain's first merged layer absorbs
 *  (`levels` above 1); a main chain of one level has no merged layer, and the props, the last
 *  level of their chain, are always loaded as every last level is. */
const propsLayer = (levels: number): HlodLayer =>
  levels > 1
    ? { name: 'props0', builder: 'instanced', parent: 'hlod1', ...gridOf(0) }
    : { name: 'props0', builder: 'instanced', spatiallyLoaded: false }

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
      'must be the simple form { levels, groups, default } or the expert form { layers, assign, ' +
        'default }; leave it out for no HLOD',
    )
  if ('layers' in options) {
    const mixed = SIMPLE_FIELDS.find((field) => field !== 'default' && field in options)
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
  const fallback = options.default ?? DEFAULT_HLOD_GROUP
  if (fallback !== 'none' && !HLOD_GROUPS.includes(fallback))
    refuse(`default must be ${HLOD_GROUPS.join(', ')} or none, got ${String(fallback)}`)
  // Every group's chain, which a mark may name whatever the rules.
  const layers: HlodLayer[] = [
    ...chain('hlod', levels),
    { name: 'foliage0', builder: 'instanced', parent: 'foliage1', ...gridOf(0) },
    { name: 'foliage1', builder: 'voxel', spatiallyLoaded: false },
    propsLayer(levels),
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
  const wire: HlodWire = { layers, assign, marks }
  if (fallback !== 'none') wire.default = marks[fallback]
  return wire
}
