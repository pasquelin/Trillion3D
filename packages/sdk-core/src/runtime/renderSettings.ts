/**
 * The render settings registry: one typed table of the engine's switchable settings, each value
 * resolved from four sources by priority, `default < quality < page < editor`. A source never
 * overwrites a stronger one: a preset writes the `quality` layer, the page its own, and a value the
 * page set holds through every preset change. The table references the engine's own constants as
 * its defaults, never a copy, so with nothing written every setting is exactly today's value.
 */

/** The groups a quality level is chosen for, in their code names (the D3 names, in English). */
export const QUALITY_GROUPS = [
  'viewDistance',
  'edgeSmoothing',
  'imageEffects',
  'shadows',
  'reflections',
  'textures',
  'effects',
  'indirectLight',
] as const
/** A group a quality level is chosen for. */
export type QualityGroup = (typeof QUALITY_GROUPS)[number]

/**
 * When a change reaches the image: `uniform`, a word written at every frame; `frame`, a choice the
 * CPU makes at every frame; `resources`, buffers made aside, the old ones in use until they are
 * ready; `pipeline`, a program compiled aside, never in the middle of a frame.
 */
type RenderSettingApply = 'uniform' | 'frame' | 'pipeline' | 'resources'
/** What a change throws away: nothing, the cached shadow pages, or the antialiasing's history. */
type RenderSettingInvalidation = 'none' | 'shadowCache' | 'taaHistory'

interface EntryBase {
  /** When a change reaches the image. */
  apply: RenderSettingApply
  /** The quality group whose levels write it. */
  group: QualityGroup
  /** Set by the editor alone: neither a preset nor a page writes it. */
  editorOnly: boolean
  /** What a change throws away. */
  invalidates: RenderSettingInvalidation
}

/** One setting of the table: its kind, its default — an engine constant — and its bounds. */
export type RenderSettingEntry =
  | (EntryBase & { kind: 'flag'; default: boolean })
  | (EntryBase & { kind: 'int' | 'float'; default: number; range: readonly [number, number] })
  | (EntryBase & { kind: 'enum'; default: number; values: readonly number[] })

/** A setting's value: a switch, or a number. */
export type RenderSettingValue = boolean | number
/** The value type of `entry`. */
type ValueOf<E extends RenderSettingEntry> = E extends { kind: 'flag' } ? boolean : number

/** Who wrote a value, weakest first after the default: a preset, the page, the editor. */
export type RenderSettingSource = 'quality' | 'page' | 'editor'
/** The written sources, strongest first: the first that holds a value gives it. */
const STRONGEST_FIRST: readonly RenderSettingSource[] = ['editor', 'page', 'quality']

/** Throws unless `value` is one `entry` takes from `source`. */
function check(name: string, entry: RenderSettingEntry, value: unknown, source: string) {
  if (entry.editorOnly && source !== 'editor')
    throw new Error(`RENDER_SETTING_EDITOR_ONLY: ${name} is the editor's`)
  const fits =
    entry.kind === 'flag'
      ? typeof value === 'boolean'
      : typeof value === 'number' &&
        (entry.kind === 'enum'
          ? entry.values.includes(value)
          : (entry.kind === 'float' ? Number.isFinite(value) : Number.isInteger(value)) &&
            value >= entry.range[0] &&
            value <= entry.range[1])
  if (!fits) throw new Error(`RENDER_SETTING_VALUE: ${name} does not take ${String(value)}`)
}

/**
 * A registry over `table`: every value resolved from its layers by priority, and the hooks that
 * apply a setting called once each time its resolved value changes — never for a write a stronger
 * source hides.
 */
export function createRenderSettings<T extends Readonly<Record<string, RenderSettingEntry>>>(
  table: T,
) {
  type Name = keyof T & string
  const layers: Record<RenderSettingSource, Map<string, RenderSettingValue>> = {
    quality: new Map(),
    page: new Map(),
    editor: new Map(),
  }
  const hooks = new Map<string, Set<(value: never) => void>>()
  const entryOf = (name: string) => {
    const entry = table[name]
    if (!entry) throw new Error(`RENDER_SETTING_UNKNOWN: ${name}`)
    return entry
  }
  const resolve = (name: string): RenderSettingValue => {
    for (const source of STRONGEST_FIRST) {
      const value = layers[source].get(name)
      if (value !== undefined) return value
    }
    return entryOf(name).default
  }
  /** Runs `change` on a layer, then the hooks of `name` if its resolved value moved. */
  const write = (name: string, change: () => void) => {
    const before = resolve(name)
    change()
    const after = resolve(name)
    if (after !== before) for (const hook of hooks.get(name) ?? []) hook(after as never)
  }
  return {
    /** The table the registry resolves. */
    table,
    /** The value `name` resolves to now. */
    get: <N extends Name>(name: N) => resolve(name) as ValueOf<T[N]>,
    /** The strongest source holding a value of `name`, `'default'` when none does. */
    source(name: Name): RenderSettingSource | 'default' {
      entryOf(name)
      return STRONGEST_FIRST.find((source) => layers[source].has(name)) ?? 'default'
    },
    /** Writes `value` into the layer of `source`; refused when out of the entry's bounds. */
    set<N extends Name>(name: N, value: ValueOf<T[N]>, source: RenderSettingSource) {
      check(name, entryOf(name), value, source)
      write(name, () => layers[source].set(name, value))
    },
    /** Removes the value `source` wrote for `name`: a weaker source's, or the default, shows. */
    clear(name: Name, source: RenderSettingSource) {
      entryOf(name)
      write(name, () => layers[source].delete(name))
    },
    /** Calls `hook` with each new resolved value of `name`; returns its remover. */
    watch<N extends Name>(name: N, hook: (value: ValueOf<T[N]>) => void) {
      entryOf(name)
      const set = hooks.get(name) ?? new Set()
      hooks.set(name, set.add(hook as (value: never) => void))
      return () => void set.delete(hook as (value: never) => void)
    },
  }
}
