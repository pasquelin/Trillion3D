import { WORLD_AT_WGSL } from '../../lighting/deferred/worldAtWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { DISTORTION_FUDGE } from '../distortionFudge.ts'
import { DISTORTION_BINDINGS, DISTORTION_GROUP } from '../stagePipelines.ts'
import { VSM_CM_PER_UNIT } from '../../lighting/shadows/vsm/constants.ts'

/** The precision scale of the stored offsets: written four times larger and divided back at the
 *  application, so the half-float target keeps more bits of the small offsets. */
const DISTORTION_SCALE = 4

/**
 * The distortion of a refracting fragment, in the blend module (`transmitWgsl.ts`): its
 * accumulation, of a glTF material's index of refraction (`KHR_materials_ior`), in full at every
 * incidence: the view normal's `xy` — the camera's axes, written once an image (`viewRight`,
 * `viewUp`) — times `ior − 1`, clipped
 * under a pixel, scaled to the view by the distortion parameters (the projection's `M[0][0]`, the
 * aspect, the display's unscaled size, never the render scale's) and its fudge,
 * faded where the opaque scene behind lies within a centimetre, scaled up four times, stored
 * positive in red and green, negative in blue and alpha, for the additive blend to sum every
 * refracting layer's. Then its application, merged back into the scene colour: the copy of the
 * opaque scene sampled bilinear at the moved coordinate, unmoved past the bilinear border, where
 * the sample would weigh texels outside the image.
 */
export const DISTORTION_WGSL = wgslBlock(
  'DISTORTION_WGSL',
  [WORLD_AT_WGSL, clampToExtent],
  `@group(${DISTORTION_GROUP}) @binding(${DISTORTION_BINDINGS.depth}) var distortionDepth:texture_depth_2d;
@group(${DISTORTION_GROUP}) @binding(${DISTORTION_BINDINGS.offsets}) var distortionOffsets:texture_2d<f32>;
@group(${DISTORTION_GROUP}) @binding(${DISTORTION_BINDINGS.scene}) var distortionScene:texture_2d<f32>;
@group(${DISTORTION_GROUP}) @binding(${DISTORTION_BINDINGS.sampler}) var distortionSampler:sampler;
const DISTORTION_FUDGE=${DISTORTION_FUDGE};
const DISTORTION_CENTIMETRES=${VSM_CM_PER_UNIT}.0;
fn distortionOffset(ior:f32,N:vec3f,P:vec3f,pixel:vec2f)->vec4f{
 let size=view.viewport.xy;
 let texel=1.0/size;
 let uv=pixel*texel;
 let viewNormal=vec2f(dot(uni.viewRight.xyz,N),dot(uni.viewUp.xyz,N));
 let raw=viewNormal*(ior-1.0);
 // Under a pixel the distortion is clipped: nothing is accumulated.
 if(all(abs(raw)<texel)){return vec4f(0.0);}
 // Scaled at the display's size, never the render's (\`writeDistortionView\`).
 var d=raw*vec2f(DISTORTION_FUDGE,-DISTORTION_FUDGE)*vec2f(uni.viewRight.w,uni.viewUp.w);
 // Soft threshold on the opaque depth at the moved coordinate, zero bias: the scene within a
 // centimetre behind the surface is not distorted. The sky is infinitely far; an orthographic
 // view's surface depth is its clip w, one, against a linear scene depth.
 let at=clampToExtent(vec2i(floor((uv+d)*size)),vec2i(size));
 let z=textureLoad(distortionDepth,at,0);
 var fade=1.0;
 if(z>0.0&&any(uni.clipW.xyz!=vec3f(0.0))){
  let scene=dot(uni.clipW,vec4f(worldAt(vec2f(at)+0.5,z),1.0));
  let surface=dot(uni.clipW,vec4f(P,1.0));
  fade=saturate((scene-surface)*DISTORTION_CENTIMETRES);
 }
 d*=fade*${DISTORTION_SCALE}.0;
 return vec4f(max(d,vec2f(0.0)),abs(min(d,vec2f(0.0))));
}
// The scene copy at pixel \`pixel\` moved by the offsets accumulated there; none where none was.
fn distortedScene(pixel:vec2f)->vec4f{
 let accumulated=textureLoad(distortionOffsets,vec2i(pixel),0);
 if(all(accumulated==vec4f(0.0))){discard;}
 let size=view.viewport.xy;
 let texel=1.0/size;
 let uv=pixel*texel;
 var moved=uv+(accumulated.rg-accumulated.ba)/${DISTORTION_SCALE}.0;
 if(any(moved<0.5*texel)||any(moved>1.0-0.5*texel)){moved=uv;}
 // Bilinear by the sampler (rgba16float filters), on the copy's whole texture, which may be larger
 // than the image drawn: inside the border above, no texel past the image is weighed.
 return textureSampleLevel(distortionScene,distortionSampler,moved*size/vec2f(textureDimensions(distortionScene)),0.0);
}`,
)
