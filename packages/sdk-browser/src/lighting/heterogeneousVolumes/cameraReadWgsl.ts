import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { BEER_DATA_WGSL } from './beerShadowMapWgsl.ts'

/**
 * THE READ OF THE CAMERA'S BEER MAP BY A TRANSLUCENT LAYER (AVSM_SampleCameraRadianceAndTransmittance4, the base pass's fogging): the
 * transmittance of the volumes between the camera and the layer's point, the exponential fitted to the two ends of each of the four texels
 * round the pixel (`beerInterpolate`) at the point's distance from the eye, blended bilinearly, and the radiance image read the same
 * way, weighed by the share of the volumes' opacity that lies in front of the point, (1 - T) / (1 - the image's transmittance). The
 * fog the layer is seen through becomes the volumes' radiance plus the fog times T, its transmittance times T.
 * The program declares the array at `binding` (layer 0 the map, layer 1 the radiance image, `cameraMap.ts`).
 */
export const hvCameraReadWgsl = (binding: number) =>
  wgslBlock(
    `hvCameraReadWgsl(${binding})`,
    [BEER_DATA_WGSL],
    `@group(0) @binding(${binding}) var hvCamera:texture_2d_array<f32>;
fn hvCameraTexel(layer:i32,at:vec2i)->vec4f{
 let last=vec2i(textureDimensions(hvCamera))-vec2i(1);
 return textureLoad(hvCamera,clamp(at,vec2i(0),last),layer,0);
}
fn hvCameraFog(fog:vec4f,P:vec3f,eye:vec3f,pixel:vec2f,factor:f32,preExposure:f32)->vec4f{
 let coord=pixel/factor-vec2f(0.5);
 let base=vec2i(floor(coord));
 let w=fract(coord);
 let z=distance(P,eye);
 var transmittance=0.0;
 var image=vec4f(0.0);
 for(var k=0;k<4;k++){
  let corner=vec2i(k&1,k>>1u);
  let weight=select(1.0-w.x,w.x,corner.x==1)*select(1.0-w.y,w.y,corner.y==1);
  transmittance+=weight*beerInterpolate(hvCameraTexel(0,base+corner),z);
  image+=weight*hvCameraTexel(1,base+corner);
 }
 let open=1.0-image.a;
 let share=saturate((1.0-transmittance)*select(0.0,1.0/open,open>0.0));
 let radiance=image.rgb*share/max(preExposure,1e-6);
 return vec4f(radiance+fog.rgb*transmittance,fog.a*transmittance);
}`,
  )
