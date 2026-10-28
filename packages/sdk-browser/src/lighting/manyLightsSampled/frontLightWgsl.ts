/**
 * THE NEAREST TRANSLUCENT LAYER'S LIGHT, WHERE ITS FRAGMENTS READ IT: one thread a pixel of the view copies the light the sampled lighting left for the layer
 * (the composite of its image, `spatialWgsl.ts`) into the second half of the front's traced radiance (twice the view tall while the layer is lit by the sampled lighting,
 * `lighting/reflections/frontLayer.ts`): the colour's red and green as two half floats in the first word, its blue and a one as two in the second, which is zero where
 * the layer holds no lit surface (its flags are zero) — the mark a fragment tests (`blend/fragmentWgsl.ts`). The blend stage has no binding to spare for a texture of its own.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { FRONT_TRACED_FORMAT } from '../reflections/frontLayer.ts'
import { SAMPLED_GROUP } from './layout.ts'

export const FRONT_LIGHT_ENTRY = 'frontLightMain'
/** The bindings of the kernel: the composite, the layer's words and the traced radiance written. */
export const FRONT_LIGHT_BINDINGS = { composite: 0, words: 1, traced: 2 } as const

/** What the mark a lit texel carries says besides that it is lit: the sampled light of the layer holds no diffuse light (`specularOnly`: the translucency volume's, which the
 *  fragment adds), or holds no sun (`sunsApart`: the directional lights stay with the forward loop). The mark is their sum on one: 1, 3, 5 or 7. */
export const FRONT_MARK = { lit: 1, specularOnly: 2, sunsApart: 4 } as const

export const frontLightWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${FRONT_LIGHT_BINDINGS.composite}) var composite:texture_2d<f32>;
@group(0) @binding(${FRONT_LIGHT_BINDINGS.words}) var words:texture_2d_array<u32>;
@group(0) @binding(${FRONT_LIGHT_BINDINGS.traced}) var traced:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
override MARK:f32=${FRONT_MARK.lit}.0;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${FRONT_LIGHT_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(composite);
 if(id.x>=size.x||id.y>=size.y){return;}
 let coord=vec2i(id.xy);
 let lit=textureLoad(words,coord,${SURFACE_WORDS.flags},0).r!=0u;
 let light=textureLoad(composite,coord,0).rgb;
 textureStore(traced,vec2u(id.x,id.y+size.y),vec4u(pack2x16float(light.rg),select(0u,pack2x16float(vec2f(light.b,MARK)),lit),0u,0u));
}`,
    [],
  )
