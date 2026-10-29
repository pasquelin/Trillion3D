import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { equalAreaDecode, equalAreaEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { SKY_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { skyLightReadWgsl, type SkyLightBindings } from '../../modules/sky/skyLight/read.ts'

/** The side, in texels, of the sky's sampling table for a sky cube of side `cubeSide`: a square map of equal-area cells over the sphere, twice the cube's side rounded up to a power of
 *  two (it resamples a cube into one map, so it takes about the texels of the cube's six faces), held to what the device's textures allow. */
export const skyTableSize = (cubeSide: number, maxTexture: number) =>
  Math.min(nextPow2(2 * Math.max(cubeSide, 1)), maxTexture)

/** Levels of the table's density, down to one texel: its mean. */
export const skyTableMips = (size: number) => Math.log2(size) + 1

/**
 * WHAT THE PATH TRACER READS OF THE SKY (`ptSkyEval`, `ptSkySample`, `ptSkyEstimate`), over the tables `ptSkyTexture` (the sky light's radiance along the
 * direction of each cell of an equal-area map of the sphere, times the sky light's colour) and `ptSkyPdf` (a density for each cell, the greatest channel of its
 * radiance, with a mip chain of the means of four cells down to the one texel that holds the table's mean), declared by the program that lists this block.
 * A table of a black sky has the mean 0 and is never sampled.
 *
 * - `ptSkyEval(d)` is the radiance along the unit direction `d`, read bilinearly (by loads, so that a device that cannot filter 32-bit floats reads the same),
 *   with the density of choosing `d` by `ptSkySample`: the cell's density over the table's total (`4π` times the mean).
 * - `ptSkySample(e)` chooses a direction by descending the mip chain from the one texel: at each level the four cells below share the density
 *   of their parent, the two columns first and the two cells of the column chosen next, and the number `e` is stretched back to [0, 1) as the choice
 *   is made, so that one pair of numbers picks the cell and the point in it. It returns the direction, its radiance and its density.
 * - `ptSkyEstimate()` is what the light picking counts of the sky: `4π` times the mean density, which cancels the constant of the density above.
 */
export const PT_SKY_WGSL = wgslBlock(
  'PT_SKY_WGSL',
  [PI, equalAreaEncode, equalAreaDecode],
  `struct PtSky{radiance:vec3f,pdf:f32,direction:vec3f,}
fn ptSkyMean()->f32{return textureLoad(ptSkyPdf,vec2i(0),i32(textureNumLevels(ptSkyPdf))-1).x;}
fn ptSkyEstimate()->f32{return 4.0*PI*ptSkyMean();}
fn ptSkyTexel(p:vec2i)->vec4f{
 let q=clamp(p,vec2i(0),vec2i(textureDimensions(ptSkyTexture))-vec2i(1));
 return vec4f(textureLoad(ptSkyTexture,q,0).xyz,textureLoad(ptSkyPdf,q,0).x);
}
fn ptSkyEval(d:vec3f)->vec4f{
 let size=vec2f(textureDimensions(ptSkyTexture));
 let at=equalAreaEncode(d)*size-vec2f(0.5);
 let base=floor(at);
 let f=at-base;
 let b=vec2i(base);
 let r=mix(mix(ptSkyTexel(b),ptSkyTexel(b+vec2i(1,0)),f.x),mix(ptSkyTexel(b+vec2i(0,1)),ptSkyTexel(b+vec2i(1,1)),f.x),f.y);
 let total=4.0*PI*ptSkyMean();
 return vec4f(r.xyz,select(0.0,r.w/total,r.w>0.0));
}
fn ptSkySample(e:vec2f)->PtSky{
 var uv=e;
 var pixel=vec2i(0);
 let levels=i32(textureNumLevels(ptSkyPdf));
 for(var level=levels-2;level>=0;level--){
  pixel*=2;
  let p00=textureLoad(ptSkyPdf,pixel,level).x;
  let p10=textureLoad(ptSkyPdf,pixel+vec2i(1,0),level).x;
  let p01=textureLoad(ptSkyPdf,pixel+vec2i(0,1),level).x;
  let p11=textureLoad(ptSkyPdf,pixel+vec2i(1,1),level).x;
  let l=p00+p01;
  let r=p10+p11;
  let probX=l/(l+r);
  if(uv.x<probX){
   uv.x/=probX;
   let probY=p00/l;
   if(uv.y<probY){uv.y/=probY;}else{pixel.y++;uv.y=(uv.y-probY)/(1.0-probY);}
  }else{
   pixel.x++;
   uv.x=(uv.x-probX)/(1.0-probX);
   let probY=p10/r;
   if(uv.y<probY){uv.y/=probY;}else{pixel.y++;uv.y=(uv.y-probY)/(1.0-probY);}
  }
 }
 let texel=ptSkyTexel(pixel);
 let size=f32(textureDimensions(ptSkyTexture).x);
 var out:PtSky;
 out.radiance=texel.xyz;
 out.pdf=texel.w/(4.0*PI*ptSkyMean());
 out.direction=equalAreaDecode((vec2f(pixel)+uv)/size);
 return out;
}`,
)

/** The sky light's resources a program that makes the table binds (`skyLightReadWgsl`, read by `skyRadiance`). */
export const ptSkyBuildWgsl = (sky: SkyLightBindings) =>
  wgslBlock(
    `PT_SKY_BUILD_WGSL(${sky.group},${sky.cube})`,
    [skyLightReadWgsl(sky), SKY_READ_WGSL],
    '',
  )

/** The kernels that make the sky's table, 8 by 8 texels a group. */
export const PT_SKY_PREPARE_ENTRY = 'ptSkyPrepare'
export const PT_SKY_MIP_ENTRY = 'ptSkyMip'
export const PT_SKY_COMPENSATE_ENTRY = 'ptSkyCompensate'

/**
 * THE SKY'S TABLE (`ptSkyPrepare`): every cell of the equal-area map takes the sky light's radiance along its direction (the sharp filtered cube, times the light's colour)
 * and the greatest of its channels as its density (`ptSkyTexture`, `ptSkyPdf` level 0). `ptSkyMip` makes a level of the density from the one above, the mean of four cells
 * (the level read by `ptSkyMipSource`, the level written `ptSkyPdfOut`). `ptSkyCompensate` takes from the density of every cell the mean of the table, to a floor of 0,
 * so that what the material's samples find without help (anything under the mean) is left to them when both strategies are weighed (MIS compensation); the mip chain is made again after it.
 */
export const PT_SKY_KERNELS_WGSL = (sky: SkyLightBindings) =>
  wgslBlock(
    `PT_SKY_KERNELS_WGSL(${sky.group})`,
    [ptSkyBuildWgsl(sky), equalAreaDecode],
    `struct PtSkyBuild{size:u32,mean:u32,}
@group(1) @binding(0) var<uniform> ptSkyBuild:PtSkyBuild;
@group(1) @binding(1) var ptSkyTextureOut:texture_storage_2d<rgba32float,write>;
@group(1) @binding(2) var ptSkyPdfOut:texture_storage_2d<r32float,read_write>;
@group(1) @binding(3) var ptSkyMipSource:texture_2d<f32>;
@compute @workgroup_size(8,8,1)
fn ${PT_SKY_PREPARE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(ptSkyBuild.size))){return;}
 let uv=(vec2f(id.xy)+0.5)/f32(ptSkyBuild.size);
 let pixel=max(skyRadiance(equalAreaDecode(uv)),vec3f(0.0));
 textureStore(ptSkyTextureOut,vec2i(id.xy),vec4f(pixel,max(pixel.x,max(pixel.y,pixel.z))));
 textureStore(ptSkyPdfOut,vec2i(id.xy),vec4f(max(pixel.x,max(pixel.y,pixel.z))));
}
@compute @workgroup_size(8,8,1)
fn ${PT_SKY_MIP_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(ptSkyBuild.size))){return;}
 let at=vec2i(id.xy)*2;
 let sum=textureLoad(ptSkyMipSource,at,0).x+textureLoad(ptSkyMipSource,at+vec2i(1,0),0).x+textureLoad(ptSkyMipSource,at+vec2i(0,1),0).x+textureLoad(ptSkyMipSource,at+vec2i(1,1),0).x;
 textureStore(ptSkyPdfOut,vec2i(id.xy),vec4f(0.25*sum));
}
@compute @workgroup_size(8,8,1)
fn ${PT_SKY_COMPENSATE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=vec2u(ptSkyBuild.size))){return;}
 let mean=textureLoad(ptSkyMipSource,vec2i(0),0).x;
 let was=textureLoad(ptSkyPdfOut,vec2i(id.xy)).x;
 textureStore(ptSkyPdfOut,vec2i(id.xy),vec4f(max(was-mean,0.0)));
}`,
  )
