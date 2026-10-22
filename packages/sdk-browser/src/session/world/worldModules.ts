import { createModuleManager } from '../../../../sdk-core/src/modules/manager.ts'
import type { ModuleOption, ModuleState } from '../../../../sdk-core/src/modules/descriptor.ts'
import {
  checkSkyOption,
  resolveSky,
  SKY_MODULE,
  type ResolvedSky,
} from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import { STATS_MODULE, statsParts } from '../../../../sdk-core/src/modules/stats/descriptor.ts'
import type { RenderSettingSource } from '../../../../sdk-core/src/runtime/renderSettings.ts'
import type { Light } from '../../../../sdk-core/src/world/light/light.ts'
import { startStats, type StatsHandle, type StatsSource } from '../../modules/stats/index.ts'
import { skyLights } from './skyLights.ts'

/** The modules a world runs. */
export type ModuleName = 'sky' | 'stats'

/** What the sky module gives the world while it runs: its parts resolved, and its own lights. */
export interface WorldSky {
  readonly resolved: ResolvedSky | undefined
  readonly lights: readonly Light[]
}

/** The sky of a world whose module is off, or has no module. */
export const NO_SKY: WorldSky = { resolved: undefined, lights: [] }

/** The sky module as it runs; rewritten in place when its merged parts change. */
type SkyRun = { resolved: ResolvedSky; lights: readonly Light[] }
type Run = SkyRun | StatsHandle

/** What a start needs of the world: the world the stats module watches, and where its panel stands. */
type Context = { world: StatsSource | undefined; panel: HTMLElement | undefined }

/** A stats module for a world not yet bound: it reports nothing and has nothing to stop. */
const IDLE_STATS: StatsHandle = { read: () => null, stop() {}, ready: Promise.resolve() }

const skyRun = (parts: ModuleState['parts']): SkyRun => {
  const resolved = resolveSky(parts)
  return { resolved, lights: skyLights(resolved) }
}

/**
 * The modules of one world: the sky and the stats, their layered options (the scene's, the page's)
 * and what runs. A module that is off holds nothing: the sky has no lights and no parts, the stats
 * no collector. A change is applied at once and asks the lights to be written again.
 */
export function createWorldModules(host: { canvas: HTMLCanvasElement; changed: () => void }) {
  let sky: SkyRun | undefined
  const context: Context = { world: undefined, panel: undefined }
  const manager = createModuleManager<ModuleName, Context, Run>([SKY_MODULE, STATS_MODULE], {
    sky: {
      start: (_, parts) => (sky = skyRun(parts)),
      stop: () => void (sky = undefined),
      update: (run, parts) => void Object.assign(run, skyRun(parts)),
    },
    stats: {
      start: ({ world, panel }, parts) =>
        world ? startStats(world, { parts: statsParts(parts), parent: panel }) : IDLE_STATS,
      stop: (run) => (run as StatsHandle).stop(),
    },
  })
  const write = (source: RenderSettingSource, name: ModuleName, value: ModuleOption) => {
    if (name === 'sky') checkSkyOption(value)
    manager.set(source, name, value)
    context.panel = host.canvas.parentElement ?? undefined
    manager.apply(context)
    host.changed()
  }
  return {
    /** The sky module's resolved parts and lights while it runs. */
    get sky(): WorldSky {
      return sky ?? NO_SKY
    },
    /** The scene's word on the sky module (`scene.sky`). */
    scene: (value: ModuleOption) => write('scene', 'sky', value),
    /** The page's words (`world.modules`): they hold over the scene's. */
    page: {
      set: (name: ModuleName, value: ModuleOption) => write('page', name, value),
      clear: (name: ModuleName) => write('page', name, null),
      state: (name: ModuleName) => manager.state(name),
    },
    /** The world the stats module watches, once the world is made. */
    bind(world: StatsSource) {
      context.world = world
    },
    /** Stops every running module. */
    dispose: () => manager.dispose(),
  }
}

/** What a world's modules are. */
export type WorldModules = ReturnType<typeof createWorldModules>
