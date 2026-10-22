import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { fogBlockOf } from '../../../lighting/fog/read.ts'
import {
  AIR_FOG_BINDINGS,
  airProgram,
  type AirBindings,
} from '../../../lighting/atmosphere/programs.ts'
import {
  BOUNDED_READ_WGSL,
  BOUNDS_FIELD,
  DEVICE_DEPTH_FLOOR,
  RECONSTRUCT_DOWNSAMPLE,
} from './reconstructLayout.ts'

/** The composition's uniform: the reconstructed images' texture size, the bounds of their reads
 *  (`writeSafeBounds`, `reconstructLayout.ts`), and `distances`: the distance under which a pixel takes no
 *  cloud (kilometres), the distance every depth must pass for the cloud to be read bilinearly, and
 *  whether the fog is laid on the cloud here (1) or was in the trace (0). */
export const COMPOSE_VIEW = fieldLayout('ComposeView', [
  ['textureSize', 'vec4f'],
  ['bounds', BOUNDS_FIELD],
  ['distances', 'vec4f'],
] as const)

/** Where the composition binds the cloud images, in group 1 (group 0 is the air's). */
export const COMPOSE_BINDING = {
  view: 0,
  colour: 1,
  secondary: 2,
  depth: 3,
  sceneDepth: 4,
  sampler: 5,
} as const

/** What the composition binds of the air: the buffer, the image's frame and the fog's resources. */
export const COMPOSE_AIR_BINDINGS: AirBindings = { air: 'read', frame: true, fog: true }

const B = COMPOSE_BINDING
/** The cloud is read bilinearly where the range of the four texels' depths is under this, km. */
const BILINEAR_RANGE_KM = 1
/** A cloud front is behind the pixel, past this margin, km. */
const FRONT_MARGIN_KM = 0.001

/** The fog of the scene, the haze apart — the cloud's own trace lays the haze: the height fog or
 *  the linear one, the volume nearest of all. The trace lays it with the late fog off, the
 *  composition with it on. */
export const CLOUD_FOG_WGSL = wgslBlock(
  'CLOUD_FOG_WGSL',
  [fogBlockOf(AIR_FOG_BINDINGS)],
  `
fn cloudFog(P:vec3f,eye:vec3f)->vec4f{
 let mode=directLights.fog[${FOG_SLOT.color}].w;
 let withSky=directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(mode>${FOG_MODE.exponential - 0.5}){
  over=fogStack(fogVolumeLookup(P-eye,false),heightFog(P,eye,withSky));
 }else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 return over;
}`,
)

const BODY = `
${COMPOSE_VIEW.wgsl}
@group(1) @binding(${B.view}) var<uniform> view:ComposeView;
@group(1) @binding(${B.colour}) var cloudColour:texture_2d<f32>;
@group(1) @binding(${B.secondary}) var cloudSecondary:texture_2d<f32>;
@group(1) @binding(${B.depth}) var cloudDepth:texture_2d<f32>;
@group(1) @binding(${B.sceneDepth}) var sceneDepth:texture_depth_2d;
@group(1) @binding(${B.sampler}) var linearSampler:sampler;
/** The fog laid on a cloud sample at texture coordinates \`uv\` of the reconstructed images, at the
 *  cloud's depth \`depthKm\`: the pixel the coordinates name in the view, its ray, the fog along the
 *  ray to that depth; the cloud's luminance through the fog's transmittance, the fog's light over its
 *  coverage. A sample that covers nothing is left as it is. */
fn fogOnCloud(uv:vec2f,depthKm:f32,cloud:vec4f)->vec4f{
 let coverage=saturate(1.0-cloud.a);
 if(view.distances.z==0.0||coverage<=0.0){return cloud;}
 let pixel=uv*view.textureSize.xy/${1 / RECONSTRUCT_DOWNSAMPLE};
 let ndc=pixelToNdc(pixel,frame.size.xy);
 let dir=normalize(unprojectPoint(frame.inverseViewProj,vec3f(ndc,0.5))-frame.eye.xyz);
 let fog=cloudFog(frame.eye.xyz+dir*(depthKm*1000.0),frame.eye.xyz);
 return vec4f(cloud.rgb*fog.a+coverage*fog.rgb,cloud.a);
}
@fragment fn composeMain(@builtin(position) position:vec4f)->@location(0) vec4f{
 if(frame.eye.w==0.0){discard;}
 let pixel=vec2i(position.xy);
 let deviceZ=max(DEVICE_DEPTH_FLOOR,textureLoad(sceneDepth,pixel,0));
 let scene=unprojectPoint(frame.inverseViewProj,vec3f(pixelToNdc(position.xy,frame.size.xy),deviceZ));
 let pixelKm=length(frame.eye.xyz-scene)*0.001;
 if(pixelKm<view.distances.x){discard;}
 let low=pixel/${RECONSTRUCT_DOWNSAMPLE};
 let side=vec2i(select(1,-1,low.x*${RECONSTRUCT_DOWNSAMPLE}==pixel.x),select(1,-1,low.y*${RECONSTRUCT_DOWNSAMPLE}==pixel.y));
 var coords=array<vec2i,4>(max(low,vec2i(0)),max(low+vec2i(side.x,0),vec2i(0)),max(low+side,vec2i(0)),max(low+vec2i(0,side.y),vec2i(0)));
 var depths=array<vec4f,4>(loadBounded(cloudDepth,view.bounds,coords[0]),loadBounded(cloudDepth,view.bounds,coords[1]),loadBounded(cloudDepth,view.bounds,coords[2]),loadBounded(cloudDepth,view.bounds,coords[3]));
 var best=coords[0];var bestDepth=depths[0].w;var bestGap=abs(pixelKm-depths[0].w);var bestFront=false;
 var farthest=depths[0].w;var nearest=depths[0].w;
 for(var k=0;k<4;k++){
  for(var c=0;c<2;c++){
   let d=depths[k][3-c];
   let gap=abs(pixelKm-d);
   if(gap<bestGap){best=coords[k];bestDepth=d;bestGap=gap;bestFront=c==1;}
   farthest=max(farthest,d);
   nearest=min(nearest,d);
  }
 }
 let fronts=vec4f(depths[0].x,depths[1].x,depths[2].x,depths[3].x);
 if(all(fronts>vec4f(pixelKm+${FRONT_MARGIN_KM}))){discard;}
 let closests=vec4f(depths[0].z,depths[1].z,depths[2].z,depths[3].z);
 let frontOfClosest=all(fronts<=closests);
 let leastDepth=min(min(depths[0].yzw,depths[1].yzw),min(depths[2].yzw,depths[3].yzw));
 let farEnough=all(leastDepth>=vec3f(view.distances.y));
 var cloud:vec4f;
 if(frontOfClosest&&(farthest-nearest<${BILINEAR_RANGE_KM}.0||farEnough)){
  let uv=(vec2f(coords[0])+0.25+(vec2f(side)*0.5+0.5)*0.5)*view.textureSize.zw;
  let frontKm=sampleBounded(cloudDepth,view.bounds,uv).x;
  cloud=fogOnCloud(uv,frontKm,sampleBounded(cloudColour,view.bounds,uv));
 }else{
  let texel=select(loadBounded(cloudColour,view.bounds,best),loadBounded(cloudSecondary,view.bounds,best),bestFront);
  cloud=fogOnCloud(vec2f(best)*view.textureSize.zw,bestDepth,texel);
 }
 return cloud;
}
`

/**
 * THE CLOUDS COMPOSED OVER THE LIT IMAGE, a full-screen pass drawing the cloud's luminance and
 * transmittance, which the blend lays over the image: the luminance added, the image multiplied by
 * the transmittance (`composeBlend`, `compose.ts`).
 *
 * Per view pixel:
 * - its distance from the eye, from the scene depth, under the cloud's start distance takes no
 *   cloud;
 * - it reads the 2×2 of reconstructed texels nearest to it: its own and the three on the side of
 *   it the pixel lies on. Each texel holds a closest and a furthest scene depth; the one nearest the
 *   pixel's distance is chosen (the first without a test), the closest depth taking the secondary
 *   image, the furthest the colour image;
 * - a pixel every cloud front of which lies behind its distance takes no cloud;
 * - where every cloud front is no further than its texel's closest depth, and the range of the
 *   eight depths of the four texels is under a kilometre or every depth is as far as the distance that disables the
 *   disocclusion, the colour image is read bilinearly, for a soft look; elsewhere the chosen texel
 *   is read as it is;
 * - the fog lies on the sample at the cloud's front depth read bilinearly, or at the chosen depth
 *   (`fogOnCloud`): the ray of the sample's pixel, the fog along it, the haze apart.
 */
export const composeProgram = airProgram(COMPOSE_AIR_BINDINGS, BODY, [
  CLOUD_FOG_WGSL,
  pixelToNdc,
  unprojectPoint,
  FULLSCREEN_VERTEX,
  BOUNDED_READ_WGSL,
  DEVICE_DEPTH_FLOOR,
])
