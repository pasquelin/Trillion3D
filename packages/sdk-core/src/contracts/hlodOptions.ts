/**
 * A compile job's HLOD as a host names it — a simple form of levels, or the expert form of named
 * layers and rules — and the one function that turns either into the form the compiler reads
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
  type NamePattern,
  type Refuse,
} from './nameMatch.ts'

/** A name to match (`NamePattern`): a string the exact name, a regular expression any name it
 *  matches — `{ regex, flags }` its JSON form, for a command line's `--hlod=`. */
export type HlodPattern = NamePattern

/** The expert form: named layers and the rules assigning objects to them (`HlodExpertOf`). */
export type HlodExpert = HlodExpertOf<HlodPattern>

/** The simple form: how many levels the one chain has — a list of layers, each building the actors
 *  of the cells of the layer before it on a grid twice as coarse, from `DEFAULT_HLOD_CELL_SIZE` and
 *  `DEFAULT_HLOD_LOADING_RANGE`, its last layer streamed on its grid like the others — and whether an object no mark names
 *  enters it. An object's mark names its layer (`HLOD_MARK`, a layer's name: `hlod0` to
 *  `hlod{levels - 1}`), else it enters the first layer, `hlod0`; an object whose node's `extras` say
 *  `HLOD_INCLUDE_MARK: false` enters none, and one that says `HLOD_INSTANCE_MARK: true` stands as
 *  itself in every actor its chain builds. */
export interface HlodSimple {
  /** The chain's levels, HLOD 0 included, `MIN_HLOD_LEVELS` to `MAX_HLOD_LEVELS`: the first
   *  instanced, every other merged (`MERGED_LAYER`); one level is the objects themselves, instanced
   *  and streamed on the first grid; name the expert form's `spatiallyLoaded: false` for an
   *  always-loaded top.
   *  @defaultValue {@link DEFAULT_HLOD_LEVELS} */
  levels?: number
  /** `'none'` leaves an object no mark names out of every HLOD actor — drawn in its cell alone,
   *  nothing standing for it past that cell's range; left out, such an object enters `hlod0`. */
  default?: 'none'
}

/** A job's HLOD: the simple form or the expert form (`layers`), never both. Left out, the job
 *  builds no HLOD. */
export type HlodOptions = HlodSimple | HlodExpert

/** The fields each form and a rule may hold: `default` either form's. */
const SIMPLE_FIELDS = ['levels', 'default'] as const
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

/** The settings of every merged layer of the simple form's chain: the reference's default
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

/** The chain `hlod0` … `hlod{levels - 1}`, each building the next's actors on a grid twice as
 *  coarse (`gridOf`), the last streamed on its grid like any layer (a layer's `spatiallyLoaded`
 *  defaults to `true`; the expert form sets it `false` for an always-loaded top): the first instanced — the objects themselves,
 *  batched —, every coarser level merged with `MERGED_LAYER` — one mesh per cell, its objects at
 *  their lowest LOD wearing one atlas. */
function chain(levels: number): HlodLayer[] {
  return Array.from({ length: levels }, (_, level) => ({
    name: `hlod${level}`,
    builder: level === 0 ? 'instanced' : 'merge',
    ...(level + 1 < levels ? { parent: `hlod${level + 1}` } : {}),
    ...gridOf(level),
    ...(level === 0 ? {} : MERGED_LAYER),
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
      'must be the simple form { levels, default } or the expert form { layers, assign, ' +
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
  const fallback = options.default
  if (fallback != null && fallback !== 'none')
    refuse(`default must be none or left out, got ${String(fallback)}`)
  const layers = chain(levels)
  return fallback == null ? { layers, default: layers[0].name } : { layers }
}
