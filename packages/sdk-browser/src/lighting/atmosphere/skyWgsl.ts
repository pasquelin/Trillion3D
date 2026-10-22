import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import { SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModel.ts'
import { fogBlockOf } from '../fog/readWgsl.ts'
import { PLANET_TO_SCENE } from './hazeWgsl.ts'
import { SKY_FOG_BINDINGS, airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'
import { SKY_VIEW_COORDINATES } from './tablesWgsl.ts'

/** The sky's functions: the disks of the lights, and the march of a sky pixel. */
const SKY_FUNCTIONS = `/** The disks of the air's lights seen along \`dir\` from \`p\`, a ray that misses the planet: for each
 *  light, its luminance within its angular radius, the rim softened. */
fn lightDisks(p:vec3f,dir:vec3f)->vec3f{
 let suns=airSuns();
 var disks=vec3f(0.0);
 for(var k=0u;k<suns.count;k++){
  let sun=suns.list[k];
  if(sun.disk.w!=0.0){
   let cosView=dot(dir,sun.toward);
   if(cosView>sun.cosRadius){
    let rim=saturate(2.0*(cosView-sun.cosRadius)/(1.0-sun.cosRadius));
    disks+=min(transmittanceToward(p,dir)*sun.disk.xyz*rim*frame.preExposure.x,vec3f(MAX_DISK));
   }
  }
 }
 return disks;
}
/** The light the air scatters into the ray along \`dir\`, marched from the eye: its samples between
 *  the march's least and most, thicker with the distance, jittered by \`noise\`. */
fn marchedSky(dir:vec3f,noise:f32)->vec3f{
 let top=moveToTopAtmosphere(frame.camera.xyz,dir);
 if(top.w==0.0){return vec3f(0.0);}
 var march=newMarch();
 march.variable=true;
 march.minSamples=MARCH_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(MARCH_SAMPLES_MAX,MARCH_SAMPLES_MIN);
 march.distanceInv=1.0/MARCH_DISTANCE_KM;
 march.offset=noise;
 return integrateAir(top.xyz,dir,false,march,true,airSuns(),1.0,9000000.0).radiance;
}`

/**
 * THE SKY, DRAWN WHERE NO SURFACE WAS: radiance into the HDR image, over what the resolve left
 * empty (a pixel whose surface flag is the background's), so exposure, the curve and the temporal
 * resolve treat it as a surface.
 *
 * A pixel's ray reads the sky table around the eye (`SKY_VIEW_COORDINATES`): the sky above the
 * horizon, the air's light up to the ground below it, the table's two halves meeting at the
 * horizon — or, where the quality settings ask for no table (`AirShape.skyView.fast`), the ray
 * is marched through the air, its samples jittered by the blue noise. The sun's disk is added where
 * the ray misses the planet and lies within the sun's angular radius: the disk's luminance — the
 * sun's illuminance, tinted, over its solid angle — times the air's transmittance toward it, its
 * rim softened over its outer half so it does not flicker under the temporal resolve, held under
 * 64000 per channel; the air's second light, where there is one, adds its own disk the same way.
 * What a half float holds bounds the radiance, as it bounds the table; the colour written is
 * multiplied by the image's pre-exposure (\`frame.preExposure\`), 1 in a capture.
 *
 * The fog of the scene lies over the sky as over any pixel (`fogBeyond`, `../fogShader.ts`): the
 * ray leaves the scene, it meets nothing in any distance. Looking up, the fog's density thins
 * with height and leaves the sky but at the horizon; looking level or down, the density below the
 * eye grows without end and the fog's colour alone is seen — the sky's table below the horizon,
 * which is the air in front of a ground that is not drawn, shows only where the scene has no fog.
 *
 * The pass draws premultiplied over the image, an alpha of one: the empty pixel becomes the sky.
 */
export const skyProgram = (shape: AirShape) => {
  // A marched sky pixel reads the air's lights' shadows as the haze's cells do.
  const shadowed = shape.shadows && !shape.skyView.fast
  return airProgram(
    {
      air: 'read',
      transmittance: true,
      skyView: true,
      multiScatter: !shape.skyView.fast,
      noise: !shape.skyView.fast,
      shadow: shadowed,
      cloudShadow: !shape.skyView.fast,
      frame: true,
      flags: true,
      fog: true,
    },
    `${SKY_VIEW_COORDINATES}${PLANET_TO_SCENE}
/** The largest radiance written: half what a half float holds, room for the bloom to add. */
const MAX_RADIANCE:f32=32256.0;
/** The largest luminance of a light's disk, per channel. */
const MAX_DISK:f32=64000.0;
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
${SKY_FUNCTIONS}
@fragment fn skyMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 if((textureLoad(flags,vec2i(pixel.xy),0).r&${SURFACE_MODEL_MASK}u)!=0u||frame.eye.w==0.0){discard;}
 let through=frame.inverseViewProj*vec4f(pixel.x*frame.size.z*2.0-1.0,1.0-pixel.y*frame.size.w*2.0,0.5,1.0);
 let dir=normalize(through.xyz/through.w-frame.eye.xyz);
 let height=frame.camera.w;
 var scattered:vec3f;
 if(SKY_FAST){
  let dirTable=eyeToTable(dir);
  let hitsGround=raySphereNearest(vec3f(0.0,0.0,height),dirTable,vec3f(0.0),bottomRadius())>=0.0;
  scattered=textureSampleLevel(skyViewTable,tableSampler,skyViewUv(hitsGround,dirTable,height),0.0).rgb;
 }else{
  scattered=marchedSky(dir,${shape.skyView.fast ? '0.3' : 'blueNoiseScalar(vec2u(pixel.xy),frame.index.x)'});
 }
 var radiance=scattered*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz;
 if(raySphereNearest(frame.camera.xyz,dir,vec3f(0.0),bottomRadius())<0.0){radiance+=lightDisks(frame.camera.xyz,dir);}
 let beyond=fogBeyondAt(dir,frame.eye.xyz,pixel.xy);
 return vec4f(min(preExposed(radiance*beyond.a+beyond.rgb),vec3f(MAX_RADIANCE)),1.0);
}`,
    [fogBlockOf(SKY_FOG_BINDINGS), preExposedWgsl('frame.preExposure.x')],
    shape,
  )
}
