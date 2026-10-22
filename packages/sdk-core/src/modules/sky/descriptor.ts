import {
  defineModule,
  mergeModuleParts,
  resolveModuleOption,
  type ModuleOption,
  type ModulePartFields,
  type ModuleState,
} from '../descriptor.ts'
import { validateSceneAtmosphere, type ResolvedAtmosphere } from '../../scene/core/atmosphere.ts'
import { validateSceneFog, type SceneFog } from '../../scene/core/fog.ts'
import { resolveCloudPart, type CloudPart } from './clouds.ts'
import { resolveSkyLight, type SkyLightPart } from './skyLight.ts'
import { resolveSunPart, type SunPart } from './sunPart.ts'

/** The parts of the sky module, in the order they start. */
const SKY_PARTS = ['atmosphere', 'sun', 'skyLight', 'heightFog', 'clouds'] as const
/** A part of the sky module. */
type SkyPartName = (typeof SKY_PARTS)[number]

/**
 * The sky module: the air, the sun, the sky light, the height fog and the clouds of a new world's
 * level, each a part switched alone (`true`, `false` or its settings). Off unless a source
 * switches it on (`scene.sky`, `world.modules`): off, it holds no light, draws no pass and
 * allocates nothing. Light shafts are settings of the sun, the volumetric fog a setting of the
 * height fog.
 */
export const SKY_MODULE = defineModule({
  name: 'sky',
  enabledByDefault: false,
  requires: [],
  parts: SKY_PARTS,
})

/** The height fog of the level: a density of 0.0436 of the reference's centimetre numbers, which
 *  is 0.00436 per metre (`scene/core/fogHeight.ts`), at a base 68.5 metres below the origin. */
const HEIGHT_FOG_LEVEL = { baseDensity: 0.00436, baseHeight: -68.5 } as const

/** The fields that make a fog a linear one or an extinction one: a part naming one of them is
 *  that law alone and takes none of the level's height-fog numbers. */
const OTHER_LAWS = ['near', 'far', 'density', 'heightFalloff'] as const

/** Whether `fields` name a linear or an extinction fog rather than the height fog's own law. */
export const namesOtherFogLaw = (fields: object) =>
  OTHER_LAWS.some((name) => Object.hasOwn(fields, name))

/**
 * The height fog part's fields as a fog: the level's numbers under the fields, unless the fields
 * name another law of fog (`OTHER_LAWS`), which they then complete alone.
 * @throws EngineError `INVALID_SCENE_ENVIRONMENT` for a value the fog does not take.
 */
function resolveHeightFog(fields: ModulePartFields): SceneFog {
  const base = namesOtherFogLaw(fields) ? {} : HEIGHT_FOG_LEVEL
  return validateSceneFog({ ...base, ...fields } as SceneFog)
}

/** The sky module as the engine reads it: each part resolved, absent when it is off. */
export interface ResolvedSky {
  readonly atmosphere?: ResolvedAtmosphere
  readonly sun?: SunPart
  readonly skyLight?: SkyLightPart
  readonly fog?: SceneFog
  readonly clouds?: CloudPart
}

/**
 * Every part of the module's merged `parts` resolved, a part that is off left out. The sky light
 * and the clouds are read with the quality settings' defaults here: a pass reads them with the
 * live ones through `resolveSkyLight` and `resolveCloudPart` on the same fields.
 * @throws a refusal naming the part, for a field it does not have or a value it does not take.
 */
export function resolveSky(parts: ModuleState['parts']): ResolvedSky {
  const on = (name: SkyPartName) => parts[name] || undefined
  const atmosphere = on('atmosphere'),
    sun = on('sun'),
    skyLight = on('skyLight'),
    fog = on('heightFog'),
    clouds = on('clouds')
  return {
    ...(atmosphere && { atmosphere: validateSceneAtmosphere(atmosphere) }),
    ...(sun && { sun: resolveSunPart(sun) }),
    ...(skyLight && { skyLight: resolveSkyLight(skyLight) }),
    ...(fog && { fog: resolveHeightFog(fog) }),
    ...(clouds && { clouds: resolveCloudPart(clouds) }),
  }
}

/**
 * Refuses a sky option no source could hold: not `true`, `false` or an object of the parts, or a
 * part with a field it does not have or a value it does not take. A source calls it before it
 * writes its layer, so a refused option changes nothing.
 */
export function checkSkyOption(option: ModuleOption) {
  const decision = resolveModuleOption(SKY_MODULE, option)
  if (decision) resolveSky(mergeModuleParts(SKY_MODULE, [decision]))
}
