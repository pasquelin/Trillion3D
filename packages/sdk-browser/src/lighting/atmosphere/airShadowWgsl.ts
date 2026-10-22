import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { VSM_TRACE_KINDS_SUN } from '../shadows/vsm/trace/traceWgsl.ts'
import { AIR_BINDING } from './binding.ts'

/**
 * THE SHADE OF THE AIR'S LIGHTS ON THE AIR: where a light of the air asks for it
 * (`SceneLight.shadowsAir`), a step of a march reads the light's shadow at the step's place — one
 * sample of the light's virtual shadow map, as the fog's volume reads the sun's (`directShadowWgsl`)
 * — and the light it scatters into the ray is that share of what it would be. A mountain's shadow
 * reaches into the haze, a column of light shows between two peaks.
 *
 * The program declares `airToScene(p)`, the scene's metres of a point of its march; the light's
 * place in the light buffer is in the atmosphere's block (`lightSlots`), whether it shades the air
 * in `lightFlags`. A light with no shadow, or beyond the maps, gives its full light.
 */
const SHADOW = directShadowWgsl(0, {
  vsm: {
    pageTable: AIR_BINDING.pageTable,
    projectionData: AIR_BINDING.projectionData,
    uniforms: AIR_BINDING.shadowUniforms,
    pool: AIR_BINDING.shadowPool,
  },
  trace: { view: AIR_BINDING.shadowView, noise: 0 },
  quality: 0,
  localShadows: false,
  kinds: VSM_TRACE_KINDS_SUN,
})

export const AIR_SHADOW_WGSL = wgslBlock(
  'AIR_SHADOW_WGSL',
  [DIRECT_LIGHT_WGSL, SHADOW],
  `
/** The share of light \`k\` of the air that the scene's shadows leave at the march's point \`p\`: 1
 *  where the light does not shade the air, has no shadow, or is not held. */
fn airShadow(k:u32,p:vec3f)->f32{
 if(atmo(${ATMOSPHERE_SLOT.lightFlags}u)[k]==0.0){return 1.0;}
 let slot=atmo(${ATMOSPHERE_SLOT.lightSlots}u)[k];
 if(slot<0.0){return 1.0;}
 let light=directLights.items[u32(slot)];
 return shadowFactor(i32(light.params.y),light,airToScene(p),vec3f(0.0),true);
}`,
)
