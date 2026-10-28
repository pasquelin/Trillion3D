import {
  QUALITY_GROUPS,
  type QualityGroup,
} from '../../../../sdk-core/src/runtime/renderSettings.ts'
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  RESOLUTION_MODES,
  type QualityLevel,
  type QualityLevels,
  type QualityPreset,
  type ResolutionMode,
} from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { RULE_FIELDS, type WorldSettings } from './settings.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'
import type { QualityBenchmark } from './benchmarkSource.ts'
import { NO_BENCHMARK, qualityHardware } from './qualityHardware.ts'

/** The resolution a world draws at: a mode, or a `scale` of the display per axis that replaces
 *  the mode's, fixed or `dynamic` — the frame budget then picks the scale between half of it and
 *  it. */
export interface QualityResolution {
  /** `'native'`, `'sharp'`, `'mixed'`, `'fast'` or `'turbo'`: 1, 1/1.5, 1/1.7, 1/2 or 1/3 of
   *  the display per axis. */
  mode: ResolutionMode
  /** A fraction of the display per axis, in place of the mode's. */
  scale?: number
  /** Whether the frame budget lowers the scale while the image moves. @defaultValue false */
  dynamic?: boolean
}

/** The quality a page asks when it creates a world (`WorldOptions.quality`). */
export interface WorldQualityOptions {
  /** Every group at the level of this name, or `'auto'`: each group at the level the hardware
   *  benchmark kept for this machine's adapter gives it (`max` until one is
   *  known); the resolution stays the page's, or the display's default. Where none is kept for the
   *  adapter, `'auto'` runs the benchmark once, before the first image, and keeps it; a run the page
   *  asks is `world.quality.benchmark()`. @defaultValue 'auto' */
  preset?: QualityPreset | 'auto'
  /** Groups the page sets to a level of their own, over the preset. */
  groups?: Partial<Record<QualityGroup, QualityLevel>>
  /** The resolution; `WorldOptions.renderScale`, when given, wins. @defaultValue the native mode,
   *  dynamic */
  resolution?: QualityResolution
}

const MODES = Object.keys(RESOLUTION_MODES) as ResolutionMode[]

/** The render scale `resolution` asks, through the one render-scale path: the native mode,
 *  dynamic, is the engine's own `'auto'`. */
export function renderScaleOf({ mode, scale, dynamic = false }: QualityResolution): RenderScale {
  if (!MODES.includes(mode)) throw new Error(`QUALITY_RESOLUTION: no mode ${String(mode)}`)
  const max = scale ?? RESOLUTION_MODES[mode]
  if (!dynamic) return max
  return max === 1 ? 'auto' : { min: max / 2, max }
}

/** The resolution a render scale asks: its maximum, named by its mode when one has it. */
function resolutionOf(asked: RenderScale | undefined): QualityResolution {
  if (asked === undefined) return { mode: 'native', dynamic: false }
  if (asked === 'auto') return { mode: 'native', dynamic: true }
  const dynamic = typeof asked === 'object',
    max = typeof asked === 'number' ? asked : (asked.max ?? 1),
    mode = MODES.find((name) => RESOLUTION_MODES[name] === max)
  return mode ? { mode, dynamic } : { mode: 'native', scale: max, dynamic }
}

/** What `world.quality` writes through: the render scale the page asks and the last frame's size. */
type QualityScale = {
  asked(): RenderScale | undefined
  ask(next: RenderScale): void
  drawn(): Pick<FrameMetrics, 'renderWidth' | 'renderHeight'> | null
}

const checked = <T extends string>(value: T, among: readonly string[], what: string) => {
  if (!among.includes(value)) throw new Error(`QUALITY_${what}: no ${what.toLowerCase()} ${value}`)
  return value
}

/** The settings each group's levels write over `settings` — its own, the editor's left out, and,
 *  a setting declared by rule, only those a level of the group's table lists: no level writes the
 *  others, so a group set or given back never overwrites or clears what the page set of them — and
 *  the writer of a level into a source. */
function qualityWriter(settings: WorldSettings, levels: QualityLevels) {
  const { table } = settings,
    names = Object.keys(table) as (keyof typeof table)[]
  const groupNames = new Map(
    QUALITY_GROUPS.map((group) => {
      const listed = new Set(Object.values(levels[group]).flatMap((values) => Object.keys(values)))
      const own = (name: keyof typeof table) =>
        table[name].group === group &&
        !table[name].editorOnly &&
        (!RULE_FIELDS.has(name) || listed.has(name))
      return [group, names.filter(own)] as const
    }),
  )
  return {
    /** What `level` of `group` writes into `source`: its values, the defaults where it has none —
     *  a preset leaves those to the defaults, a page writes them over the preset. */
    write(group: QualityGroup, level: QualityLevel, source: 'quality' | 'page') {
      const values = levels[group][level]
      for (const name of groupNames.get(group)!) {
        const value = values[name]
        if (source === 'quality' && value === undefined) settings.clear(name, source)
        else settings.set(name, (value ?? table[name].default) as never, source)
      }
    },
    /** Gives `group`'s settings back from the page. */
    release(group: QualityGroup) {
      for (const name of groupNames.get(group)!) settings.clear(name, 'page')
    },
    /** Every setting `level` of `group` writes, with its value. */
    full: (group: QualityGroup, level: QualityLevel) =>
      Object.fromEntries(
        groupNames
          .get(group)!
          .map((name) => [name, levels[group][level][name] ?? table[name].default]),
      ),
  }
}
type QualityWriter = ReturnType<typeof qualityWriter>

/** The resolution through the render scale, the size last drawn and the table of the levels. */
function viewAccessors(scale: QualityScale, writer: QualityWriter) {
  return {
    /** The resolution the page asks (`QualityResolution`), through the render scale: a scale
     *  without a mode of its own reads as the native mode's with that `scale`. */
    get resolution(): QualityResolution {
      return resolutionOf(scale.asked())
    },
    set resolution(next: QualityResolution) {
      scale.ask(renderScaleOf(next))
    },
    /** The size in pixels the last image was drawn at (`FrameMetrics.renderWidth`,
     *  `renderHeight`), before it was rebuilt to the display; `null` before one. */
    get renderSize(): { width: number; height: number } | null {
      const drawn = scale.drawn()
      return drawn?.renderWidth && drawn.renderHeight
        ? { width: drawn.renderWidth, height: drawn.renderHeight }
        : null
    },
    /** The presets, each group's levels with the value of every setting they write, and the
     *  resolution modes with their scale. */
    levels() {
      const groups = QUALITY_GROUPS.map((group) => [
        group,
        Object.fromEntries(QUALITY_PRESETS.map((level) => [level, writer.full(group, level)])),
      ])
      return {
        presets: [...QUALITY_PRESETS],
        groups: Object.fromEntries(groups) as Record<
          QualityGroup,
          Record<QualityLevel, Record<string, boolean | number>>
        >,
        resolution: { ...RESOLUTION_MODES },
      }
    },
  }
}

/** The preset and the groups: `state` the preset and the page's own levels, `levelOf` the level the
 *  preset gives a group, `writePreset` writes the preset through. */
function presetAccessors(
  state: { preset: QualityPreset | 'auto'; page: Map<QualityGroup, QualityLevel> },
  writer: QualityWriter,
  levelOf: (group: QualityGroup) => QualityLevel,
  writePreset: () => void,
) {
  return {
    /** The preset every group follows, `'custom'` once a group the page set differs from it.
     *  Written, the groups the page has not set take the preset's level. */
    get preset(): QualityPreset | 'auto' | 'custom' {
      for (const [group, level] of state.page) if (level !== levelOf(group)) return 'custom'
      return state.preset
    },
    set preset(next: QualityPreset | 'auto') {
      state.preset = checked(next, [...QUALITY_PRESETS, 'auto'], 'PRESET')
      writePreset()
    },
    /** The level `group` is drawn at: the page's, else the preset's. */
    get: (group: QualityGroup): QualityLevel =>
      state.page.get(checked(group, QUALITY_GROUPS, 'GROUP')) ?? levelOf(group),
    /** Sets `group` to `level` over the preset, which no later preset changes; `'preset'` gives
     *  the group back to the preset. */
    set(group: QualityGroup, level: QualityLevel | 'preset') {
      checked(group, QUALITY_GROUPS, 'GROUP')
      if (level === 'preset') {
        state.page.delete(group)
        return writer.release(group)
      }
      state.page.set(group, checked(level, QUALITY_PRESETS, 'LEVEL'))
      writer.write(group, level, 'page')
    },
  }
}

/**
 * `world.quality`: the presets and levels over the world's settings registry, and the resolution
 * over its render scale. A preset writes the registry's `quality` layer, a group the page sets its
 * `page` layer, which no preset overwrites. `scale` reads and writes the render scale the page asks,
 * and gives the last frame's metrics, which hold the size it was drawn at. Under `'auto'` the groups
 * take the levels of the hardware benchmark's result (`qualityHardware.ts`) ; the resolution stays the
 * page's or the display's default; with none kept, one run is made before the first image (`qualityHardware.ts`, `createWorldQuality`).
 */
export function createWorldQuality(
  settings: WorldSettings,
  scale: QualityScale,
  options: WorldQualityOptions = {},
  levels: QualityLevels = QUALITY_LEVELS,
  benchmark: QualityBenchmark = NO_BENCHMARK,
) {
  const writer = qualityWriter(settings, levels)
  const state = { preset: options.preset ?? 'auto', page: new Map<QualityGroup, QualityLevel>() }
  const auto = () => state.preset === 'auto'
  const hardware = qualityHardware(benchmark, () => auto() && writePreset())
  const levelOf = (group: QualityGroup): QualityLevel =>
    auto() ? (hardware.levels()?.groups[group] ?? 'max') : (state.preset as QualityLevel)
  /** Writes the preset's level of every group reading the kept
   *  result the first time under `'auto'`. */
  const writePreset = () => {
    for (const group of QUALITY_GROUPS) writer.write(group, levelOf(group), 'quality')
    if (auto()) hardware.look()
  }
  const chosen = () => {
    state.preset = 'auto'
    writePreset()
  }
  const quality = joined(
    presetAccessors(state, writer, levelOf, writePreset),
    viewAccessors(scale, writer),
    hardware.accessors(chosen),
  )
  writePreset()
  for (const [group, level] of Object.entries(options.groups ?? {}))
    quality.set(group as QualityGroup, level)
  /** `decided` is settled once the quality is decided: under `'auto'`, the kept benchmark result read or the one run made; at once under a named preset. The world opens its first
   *  session after it, so that no image is drawn at a quality the benchmark then changes. */
  return { quality, decided: hardware.settled }
}
