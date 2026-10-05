import {
  QUALITY_GROUPS,
  type QualityGroup,
} from '../../../../sdk-core/src/runtime/renderSettings.ts';
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  RESOLUTION_MODES,
  type QualityLevel,
  type QualityLevels,
  type QualityPreset,
  type ResolutionMode,
} from '../../../../sdk-core/src/runtime/qualityLevels.ts';
import type { RenderScale } from '../../frame/renderScaleOption.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { WorldSettings } from './worldSettings.ts';

/** The resolution a world draws at: a mode, or a `scale` of the display per axis that replaces
 *  the mode's, fixed or `dynamic` — the frame budget then picks the scale between half of it and
 *  it. */
export interface QualityResolution {
  /** `'native'`, `'sharp'`, `'mixed'`, `'fast'` or `'turbo'`: 1, 1/1.5, 1/1.7, 1/2 or 1/3 of
   *  the display per axis. */
  mode: ResolutionMode;
  /** A fraction of the display per axis, in place of the mode's. */
  scale?: number;
  /** Whether the frame budget lowers the scale while the image moves. @defaultValue false */
  dynamic?: boolean;
}

/** The quality a page asks when it creates a world (`WorldOptions.quality`). */
export interface WorldQualityOptions {
  /** Every group at the level of this name. @defaultValue 'max' */
  preset?: QualityPreset;
  /** Groups the page sets to a level of their own, over the preset. */
  groups?: Partial<Record<QualityGroup, QualityLevel>>;
  /** The resolution; `WorldOptions.renderScale`, when given, wins. @defaultValue the native mode,
   *  dynamic */
  resolution?: QualityResolution;
}

const MODES = Object.keys(RESOLUTION_MODES) as ResolutionMode[];

/** The render scale `resolution` asks, through the one render-scale path: the native mode,
 *  dynamic, is the engine's own `'auto'`. */
export function renderScaleOf({ mode, scale, dynamic = false }: QualityResolution): RenderScale {
  if (!MODES.includes(mode)) throw new Error(`QUALITY_RESOLUTION: no mode ${String(mode)}`);
  const max = scale ?? RESOLUTION_MODES[mode];
  if (!dynamic) return max;
  return max === 1 ? 'auto' : { min: max / 2, max };
}

/** The resolution a render scale asks: its maximum, named by its mode when one has it. */
function resolutionOf(asked: RenderScale): QualityResolution {
  if (asked === 'auto') return { mode: 'native', dynamic: true };
  const dynamic = typeof asked === 'object',
    max = typeof asked === 'number' ? asked : (asked.max ?? 1),
    mode = MODES.find((name) => RESOLUTION_MODES[name] === max);
  return mode ? { mode, dynamic } : { mode: 'native', scale: max, dynamic };
}

/**
 * `world.quality`: the presets and levels over the world's settings registry, and the resolution
 * over its render scale. A preset writes the registry's `quality` layer, a group the page sets its
 * `page` layer, which no preset overwrites. `scale` reads and writes the render scale the page asks,
 * and gives the last frame's metrics, which hold the size it was drawn at.
 */
export function createWorldQuality(
  settings: WorldSettings,
  scale: {
    asked(): RenderScale;
    ask(next: RenderScale): void;
    drawn(): Pick<FrameMetrics, 'renderWidth' | 'renderHeight'> | null;
  },
  options: WorldQualityOptions = {},
  levels: QualityLevels = QUALITY_LEVELS,
) {
  const { table } = settings,
    names = Object.keys(table) as (keyof typeof table)[],
    page = new Map<QualityGroup, QualityLevel>();
  /** The settings each group's levels write: its own, the editor's left out. */
  const groupNames = new Map(
    QUALITY_GROUPS.map(
      (group) =>
        [
          group,
          names.filter((name) => table[name].group === group && !table[name].editorOnly),
        ] as const,
    ),
  );
  let preset: QualityPreset = 'max';
  /** What `level` of `group` writes into `source`: its values, the defaults where it has none — a
   *  preset leaves those to the defaults, a page writes them over the preset. */
  const write = (group: QualityGroup, level: QualityLevel, source: 'quality' | 'page') => {
    const values = levels[group][level];
    for (const name of groupNames.get(group)!) {
      const value = values[name];
      if (source === 'quality' && value === undefined) settings.clear(name, source);
      else settings.set(name, (value ?? table[name].default) as never, source);
    }
  };
  const checked = <T extends string>(value: T, among: readonly string[], what: string) => {
    if (!among.includes(value))
      throw new Error(`QUALITY_${what}: no ${what.toLowerCase()} ${value}`);
    return value;
  };
  const quality = {
    /** The preset every group follows, `'custom'` once a group the page set differs from it.
     *  Written, the groups the page has not set take the preset's level. */
    get preset(): QualityPreset | 'custom' {
      for (const level of page.values()) if (level !== preset) return 'custom';
      return preset;
    },
    set preset(next: QualityPreset) {
      preset = checked(next, QUALITY_PRESETS, 'PRESET');
      for (const group of QUALITY_GROUPS) write(group, preset, 'quality');
    },
    /** The level `group` is drawn at: the page's, else the preset's. */
    get: (group: QualityGroup): QualityLevel =>
      page.get(checked(group, QUALITY_GROUPS, 'GROUP')) ?? preset,
    /** Sets `group` to `level` over the preset, which no later preset changes; `'preset'` gives
     *  the group back to the preset. */
    set(group: QualityGroup, level: QualityLevel | 'preset') {
      checked(group, QUALITY_GROUPS, 'GROUP');
      if (level !== 'preset') {
        page.set(group, checked(level, QUALITY_PRESETS, 'LEVEL'));
        return write(group, level, 'page');
      }
      page.delete(group);
      for (const name of groupNames.get(group)!) settings.clear(name, 'page');
    },
    /** The resolution the page asks (`QualityResolution`), through the render scale: a scale
     *  without a mode of its own reads as the native mode's with that `scale`. */
    get resolution(): QualityResolution {
      return resolutionOf(scale.asked());
    },
    set resolution(next: QualityResolution) {
      scale.ask(renderScaleOf(next));
    },
    /** The size in pixels the last image was drawn at (`FrameMetrics.renderWidth`,
     *  `renderHeight`), before it was rebuilt to the display; `null` before one. */
    get renderSize(): { width: number; height: number } | null {
      const drawn = scale.drawn();
      return drawn?.renderWidth && drawn.renderHeight
        ? { width: drawn.renderWidth, height: drawn.renderHeight }
        : null;
    },
    /** The presets, each group's levels with the value of every setting they write, and the
     *  resolution modes with their scale. */
    levels() {
      const full = (group: QualityGroup, level: QualityLevel) =>
        Object.fromEntries(
          groupNames
            .get(group)!
            .map((name) => [name, levels[group][level][name] ?? table[name].default]),
        );
      return {
        presets: [...QUALITY_PRESETS],
        groups: Object.fromEntries(
          QUALITY_GROUPS.map((group) => [
            group,
            Object.fromEntries(QUALITY_PRESETS.map((level) => [level, full(group, level)])),
          ]),
        ) as Record<QualityGroup, Record<QualityLevel, Record<string, boolean | number>>>,
        resolution: { ...RESOLUTION_MODES },
      };
    },
  };
  if (options.preset) quality.preset = options.preset;
  for (const [group, level] of Object.entries(options.groups ?? {}))
    quality.set(group as QualityGroup, level);
  return quality;
}
