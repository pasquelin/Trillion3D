import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../gpu/shader/fullscreenTriangle.ts'
import { BLEND_MODE, modeIs } from '../materials/surface/materialBlending.ts'
import { fogFreeFlag } from '../materials/surface/surfaceModelWord.ts'
import * as itemFlags from '../visibility/types.ts'
import type { CloudVertexText } from './cloudVertexText.ts'
import { TRI_HOLDOUT_SHIFT, WORDS } from './vertexReadsWgsl.ts'

/**
 * THE ALPHA HOLDOUT'S ACCUMULATION (`holdout.ts`), the fragment stage of the blend module that draws
 * the translucent layers once more, from far to near, into the holdout target: what each leaves of the
 * background visible. The target holds the background visibility in red, green and blue and the path
 * throughput in alpha; a layer writes what it adds to the visibility (`add`) and the share of the
 * path it lets through (`through`), and the blend lays them over what the target holds,
 * `visibility = add + visibility · through`, `throughput = throughput · through`.
 * - a translucent layer (`normal`) lets `1 − opacity` through and adds nothing; a layer that holds
 *   out (`alphaHoldout`, or of an object that is held out) adds its opacity as well; a layer that
 *   multiplies the scene (`subtractive`, `multiply`) lets `1 − opacity` through behind the fog's
 *   transmittance twice; an additive layer and a layer composed premultiplied (`alphaComposite`)
 *   touch neither. Where the alpha holdout is not in effect (\`uni.holdout\` 0) the accumulation is only
 *   the blend states' own on the image's alpha, for the layers of blending `alphaHoldout`: a
 *   premultiplied layer lets `1 − opacity` through as a translucent one does, a layer that
 *   multiplies the scene touches nothing;
 * - the fog in front of the layer scales what it adds by its transmittance (`blendFog`), and, where
 *   the height fog holds its light out (\`fogHoldout\`), adds its own coverage of the layer's.
 * \`fsBlendHoldout\` is the stage of a blend layer, its mode a constant of the pipeline
 * (\`BLEND_MODE\`); \`holdoutOut\` is the layer's output, which the transmissive stage shares.
 */
export const holdoutStageText = (shade: CloudVertexText) => `
override ${BLEND_MODE}:u32=0u;
// Whether the layer's object is held out (\`Object3D.holdout\`), where the alpha holdout is in effect.
fn holdoutPrimitive(in:VSOut)->bool{return uni.holdout!=0u&&((in.${WORDS.tri}>>${TRI_HOLDOUT_SHIFT}u)&1u)!=0u;}
fn holdoutOut(add:f32,through:f32,cover:f32,seen:f32)->vec4f{
 let fogAdd=select(0.0,cover*(1.0-seen),fogHoldout());
 return vec4f(vec3f(fogAdd+add*seen),saturate(through));
}
// The fog a layer is seen through: none for a fog-free material or the unlit view; a layer that multiplies
// the scene (\`modulating\`) is seen through it twice.
fn holdoutFog(in:VSOut,modulating:bool)->f32{
 let flags=in.ids.y;
 if((flags&${itemFlags.FLAG_UNLIT_VIEW}u)!=0u||${fogFreeFlag('flags')}){return 1.0;}
 let seen=blendFog(in).a;
 return select(seen,seen*seen,modulating);
}
@fragment fn fsBlendHoldout(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{${shade.entry}
 let g=blendGrads(in);
 let layer=blendLayer(in,front,g);
 if(!layer.kept){discard;return vec4f(0.0,0.0,0.0,1.0);}
 let opacity=saturate(layer.s.alpha);
 let inEffect=uni.holdout!=0u;
 // The modes that take part: a translucent layer and one that holds out, a layer that multiplies the scene
 // where the alpha holdout is in effect, a premultiplied layer where it is not. The others touch nothing.
 let modulating=${modeIs('subtractive', 'multiply')};
 let covers=${modeIs('normal', 'alphaHoldout')}||(inEffect&&modulating)||(!inEffect&&${modeIs('alphaComposite')});
 let held=${modeIs('alphaHoldout')}||holdoutPrimitive(in);
 var seen=1.0;
 if(inEffect){seen=holdoutFog(in,modulating);}
 let cover=select(0.0,opacity,covers);
 return holdoutOut(select(0.0,cover,held),1.0-cover,cover,seen);
}
`

/**
 * THE ALPHA HOLDOUT'S TWO FULL-SCREEN PASSES (`holdout.ts`): the start, which fills the holdout target
 * with the lit image's alpha as the background visibility and a throughput of 1, before the layers
 * are drawn into it; and the application, which lays the visibility they leave over the lit image's
 * alpha — the alpha alone, the colour untouched —, everywhere before the depth of field, and after
 * it only where a layer left something (`covered`: the throughput under 1), so that the alpha the
 * depth of field kept is left where none did.
 */
export const HOLDOUT_START_WGSL = wgslProgram(
  `
@group(0) @binding(0) var scene:texture_2d<f32>;
@fragment fn holdoutStart(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let visible=saturate(textureLoad(scene,vec2i(pixel.xy),0).a);
 return vec4f(visible,visible,visible,1.0);
}`,
  [FULLSCREEN_VERTEX],
)
export const HOLDOUT_APPLY_WGSL = wgslProgram(
  `
@group(0) @binding(0) var held:texture_2d<f32>;
@fragment fn holdoutApply(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 return vec4f(0.0,0.0,0.0,saturate(textureLoad(held,vec2i(pixel.xy),0).r));
}
@fragment fn holdoutApplyCovered(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let value=textureLoad(held,vec2i(pixel.xy),0);
 if(saturate(value.a)>=1.0){discard;}
 return vec4f(0.0,0.0,0.0,saturate(value.r));
}`,
  [FULLSCREEN_VERTEX],
)
