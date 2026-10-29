import { greyMean } from '../../../../math/src/wgsl/color.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { AIR_RAY_WGSL } from './airRayWgsl.ts'
import { AIR_TO_SCENE } from './hazeWgsl.ts'
import { airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'
import { SKY_MAX_RADIANCE } from './layout.ts'
import { SKY_VIEW_READ } from './tablesWgsl.ts'

/** The sky's functions: the disks of the lights, and the march of a sky pixel. */
const SKY_FUNCTIONS = `/** The disks of the air's lights seen along \`dir\` from \`p\`, a ray that misses the planet: for each
 *  light, its luminance within its angular radius, the rim softened, times the image's pre-exposure
 *  and then held to \`MAX_DISK\`. The pre-exposure is applied here, once: the sum is added to the
 *  sky's exposed radiance. From above the air the air a disk is seen through is the ray's chord
 *  from where it enters (\`moveToTopAtmosphere\`), none where it never does. */
fn lightDisks(p:vec3f,dir:vec3f)->vec3f{
 let suns=airSuns();
 var disks=vec3f(0.0);
 for(var k=0u;k<suns.count;k++){
  let sun=suns.list[k];
  if(sun.disk.w!=0.0){
   let cosView=dot(dir,sun.toward);
   if(cosView>sun.cosRadius){
    let rim=saturate(2.0*(cosView-sun.cosRadius)/(1.0-sun.cosRadius));
    let entry=moveToTopAtmosphere(p,dir);
    let kept=select(vec3f(1.0),transmittanceToward(entry.xyz,dir),entry.w!=0.0);
    disks+=min(kept*sun.disk.xyz*rim*frame.preExposure.x,vec3f(MAX_DISK));
   }
  }
 }
 return disks;
}
/** The light the air scatters into the ray along \`dir\`, marched from \`origin\` on the planet: its
 *  samples between the march's least and most, thicker with the distance, jittered by \`noise\`. */
fn marchedSky(origin:vec3f,dir:vec3f,noise:f32)->vec4f{
 let top=moveToTopAtmosphere(origin,dir);
 if(top.w==0.0){return vec4f(0.0,0.0,0.0,1.0);}
 let r=integrateAir(top.xyz,dir,false,airMarch(noise),true,airSuns(),1.0,AIR_REACH_KM);
 return vec4f(r.radiance,greyMean(r.transmittance));
}`

/**
 * THE SKY, DRAWN WHERE NO SURFACE WAS: radiance into the HDR image, over what the resolve left
 * empty (a pixel whose surface flag is the background's), so exposure, the curve and the temporal
 * resolve treat it as a surface.
 *
 * A pixel's ray (`airRay`, `airRayWgsl.ts`: from the eye, or, in an orthographic view, from the
 * pixel's own point on the near plane, along the view's direction) reads the sky table around the
 * eye (`SKY_VIEW_COORDINATES`), at the height it starts from: the sky above the
 * horizon, the air's light up to the ground below it, the table's two halves meeting at the
 * horizon — or, where the quality settings ask for no table (`AirShape.skyView.fast`) or the eye
 * stands above the air (the table describes a view from inside it), the ray is marched through
 * the air from where it enters it, its samples jittered by the blue noise: seen from outside, the
 * air is the planet's rim and a ray that misses it leaves black. The sun's disk is added where
 * the ray misses the planet and lies within the sun's angular radius: the disk's luminance — the
 * sun's illuminance, tinted, over its solid angle — times the air's transmittance toward it, its
 * rim softened over its outer half so it does not flicker under the temporal resolve, held under
 * 64000 per channel once multiplied by the image's pre-exposure (\`frame.preExposure\`); the air's
 * second light, where there is one, adds its own disk the same way. What a half float holds
 * bounds the radiance, as it bounds the table; the sky's colour written is multiplied by the
 * pre-exposure, once, as the disk is, 1 in a capture.
 *
 * The fog of the scene lies over the sky as over any pixel, but not in this pass: the fog pass lays it
 * over the whole image once the sky is in it (`../fog/fogPass.ts`, `fogBeyondAt`), the ray of a sky
 * pixel leaving the scene and meeting nothing in any distance. A view that hides the atmosphere
 * (`frame.hidden`) draws the sky black: the fog pass lays its colour alone over it.
 *
 * The pass draws premultiplied over the image, an alpha of one: the empty pixel becomes the sky. An
 * atmosphere that holds its light out (\`frame.hidden.y\`) draws black, its alpha the coverage of its air
 * (one minus the grey of the transmittance along the ray), which the holdout blend lays over the image's
 * alpha (\`resources.ts\`).
 */
export const skyProgram = (shape: AirShape) =>
  // A marched sky pixel (no table, or an eye above the air) reads the air's lights' shadows as the
  // haze's cells do.
  airProgram(
    {
      air: 'read',
      transmittance: true,
      skyView: true,
      multiScatter: true,
      noise: true,
      shadow: shape.shadows,
      cloudShadow: true,
      frame: true,
      flags: true,
    },
    `${SKY_VIEW_READ}${AIR_TO_SCENE}
/** The largest radiance written (\`SKY_MAX_RADIANCE\`). */
const MAX_RADIANCE:f32=${SKY_MAX_RADIANCE}.0;
/** The largest luminance of a light's disk, per channel. */
const MAX_DISK:f32=64000.0;
${SKY_FUNCTIONS}
@fragment fn skyMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 if((textureLoad(flags,vec2i(pixel.xy),0).r&${SURFACE_MODEL_MASK}u)!=0u){discard;}
 let ray=airRay(vec2f(pixel.x*frame.size.z*2.0-1.0,1.0-pixel.y*frame.size.w*2.0));
 let dir=ray.dir;
 let height=ray.height;
 if(frame.hidden.x!=0.0){return vec4f(0.0,0.0,0.0,1.0);}
 var scattered:vec4f;
 if(skyViewInside(height)){
  scattered=skyViewScattered(dir,height);
 }else{
  scattered=marchedSky(ray.origin,dir,blueNoiseScalar(vec2u(pixel.xy),frame.index.x));
 }
 if(frame.hidden.y!=0.0){return vec4f(0.0,0.0,0.0,saturate(1.0-scattered.a));}
 let radiance=scattered.rgb*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz;
 var disks=vec3f(0.0);
 if(raySphereNearest(ray.origin,dir,vec3f(0.0),bottomRadius())<0.0){disks=lightDisks(ray.origin,dir);}
 return vec4f(min(preExposed(radiance)+disks,vec3f(MAX_RADIANCE)),1.0);
}`,
    [preExposedWgsl('frame.preExposure.x'), AIR_RAY_WGSL, FULLSCREEN_VERTEX, greyMean],
    shape,
  )
