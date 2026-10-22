import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { CAPTURE_360_WGSL } from './capture360Wgsl.ts'
import {
  HAZE_UNPACK_WGSL,
  HAZE_WEIGHT_WGSL,
  hazeReadFunctions,
  viewHazeFunction,
} from './hazeReadWgsl.ts'
import { VIEW_SLOT } from './layout.ts'

/**
 * WHAT THE CLOUDS READ OF THE AIR BESIDES THE HAZE A SURFACE IS SEEN THROUGH: the haze's light
 * alone and the air's alone, each a volume of the same cells as the main one, and the haze all
 * around a capture. A program that includes this block declares the storage buffer `volumes`
 * (`array<vec2u>`, bound as `AIR_BINDING.volumes` by `AirResources.volumes`) and reads the
 * view's block through `directLights`, as the surfaces do.
 *
 * - `hazeOnly(P, eye, startKm, fadeInv)` and `airOnly(P, eye, startKm, fadeInv)`: the volumes of the
 *   haze alone and the air alone, read for the point `P` seen from `eye`, from `startKm` — the
 *   larger of the haze's start and the cloud's own distance for each — over the reciprocal distance
 *   `fadeInv` (a cloud's `1 / max(fade, 0.00001)`). A cloud adds the two readings: the lights, and
 *   the product of the transmittances.
 * - `captureHaze(dir, distanceKm, startKm)`: the haze along `dir` from the place of the capture, to
 *   `distanceKm`, from `startKm`: the volume around the capture (`capture360Program`), valid when
 *   `VIEW_SLOT.flags.z` says it was built.
 */
export const SEPARATED_READ_WGSL = wgslBlock(
  'SEPARATED_READ_WGSL',
  [HAZE_UNPACK_WGSL, HAZE_WEIGHT_WGSL, CAPTURE_360_WGSL],
  `
fn volumeWords(region:u32,index:u32,full:bool)->vec4f{
 let size=directLights.atmosphereView[${VIEW_SLOT.volume}].xyz;
 let cells=u32(size.x)*u32(size.y)*u32(size.z);
 let at=select(region*cells+index,(region*cells+index)*2u,full);
 return hazeUnpack(volumes[at],volumes[select(at,at+1u,full)],full);
}
fn hazeMieWords(index:u32,full:bool)->vec4f{return volumeWords(0u,index,full);}
fn hazeRayWords(index:u32,full:bool)->vec4f{return volumeWords(1u,index,full);}
fn hazeCaptureWords(index:u32,full:bool)->vec4f{return volumeWords(2u,index,full);}${hazeReadFunctions('hazeMie')}${hazeReadFunctions('hazeRay')}${hazeReadFunctions('hazeCapture')}${viewHazeFunction(
    {
      name: 'hazeOnly',
      reader: 'hazeMie',
      extra: ',startKm:f32,fadeInv:f32',
      start: 'startKm',
      fade: 'fadeInv',
      validity: `directLights.atmosphereView[${VIEW_SLOT.haze}].w==0.0`,
    },
  )}${viewHazeFunction({
    name: 'airOnly',
    reader: 'hazeRay',
    extra: ',startKm:f32,fadeInv:f32',
    start: 'startKm',
    fade: 'fadeInv',
    validity: `directLights.atmosphereView[${VIEW_SLOT.haze}].w==0.0`,
  })}
fn captureHaze(dir:vec3f,distanceKm:f32,startKm:f32)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 let volume=directLights.atmosphereView[${VIEW_SLOT.volume}];
 let flags=directLights.atmosphereView[${VIEW_SLOT.flags}];
 if(flags.z==0.0){return none;}
 let at=hazeWeight(max(0.0,distanceKm-startKm),volume,100000.0);
 let size=volume.xy;
 let haze=hazeCaptureAt(vec3f((capture360Unit(dir)+0.5/size)*(size/(size+1.0)),at.x),volume.xyz,flags.x!=0.0);
 return vec4f(haze.rgb*at.y,1.0-at.y*(1.0-haze.a));
}`,
)

/** The bytes the clouds' volumes take for a shape's cells: three regions (the haze alone, the air
 *  alone, the capture's), each of the cells, a cell four half floats or four 32-bit floats. */
export const volumesBytes = (cells: number, full: boolean) => 3 * cells * (full ? 16 : 8)
