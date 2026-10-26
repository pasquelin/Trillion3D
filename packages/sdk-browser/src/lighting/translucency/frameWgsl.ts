import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { TRANSLUCENCY_FRAME, TRANSLUCENCY_KINDS } from './layout.ts'

/**
 * THE TWO-BAND HARMONICS THE VOLUME HOLDS ITS LIGHT IN, written once for the injection, the filter, the surface cache's radiosity and the
 * surfaces that read it. A light of colour `C` from the unit direction `L` projects to `C · basis(L)` (`tvBasis`): the constant `TV_Y0` and
 * the three linear terms `(-TV_Y1·y, TV_Y1·z, -TV_Y1·x)` of the direction. A surface of normal `N` reads the sum of the coefficients times the
 * same basis of `N`, each band scaled by what the cosine lobe keeps of it (`TV_L0`, π, the constant band; `TV_L1`, 2π/3, the linear one): the
 * irradiance `tvIrradiance` of an ambient light (the constant band, a colour) and a directional light (the three linear bands, kept as the
 * colours' luminance alone, their colour taken from the constant band, `tvNormalisedAmbient`), never negative; `single` reads the constant
 * band alone, whatever the normal. The light is in the units the volume was written in: a reader divides by the pre-exposure that was
 * multiplied in, where one was.
 */
export const TV_SH_WGSL = wgslBlock(
  'TV_SH_WGSL',
  [PI, luminance],
  `const TV_Y0:f32=${wgslF32(0.282095)};
const TV_Y1:f32=${wgslF32(0.488603)};
const TV_L0:f32=PI;
const TV_L1:f32=${wgslF32(TAU / 3)};
/** The first two bands' basis at the unit direction \`d\`: the constant term, then the three linear ones. */
fn tvBasis(d:vec3f)->vec4f{return vec4f(TV_Y0,-TV_Y1*d.y,TV_Y1*d.z,-TV_Y1*d.x);}
/** The colour of the constant band with its luminance divided out: the colour the linear bands take. */
fn tvNormalisedAmbient(ambient:vec3f,luminance:f32)->vec3f{return ambient/(luminance+0.00001);}
/** The irradiance on a surface of normal \`N\` of the light \`ambient\` (the constant band) and \`directional\` (the linear bands' luminance). */
fn tvIrradiance(ambient:vec3f,directional:vec3f,N:vec3f,single:bool)->vec3f{
 let constant=ambient*(TV_Y0*TV_L0);
 if(single){return max(constant,vec3f(0.0));}
 let tint=tvNormalisedAmbient(ambient,luminance(ambient));
 return max(constant+tint*dot(directional,tvBasis(N).yzw*TV_L1),vec3f(0.0));
}`,
)

/** The frame's structure (`TRANSLUCENCY_FRAME`) and the two reads of the cascades' cells every pass
 *  shares: the point a cell's centre lies at (`tvCellPoint`) and how far inside the outer cascade's edge a cell is
 *  (`tvBorder`: 1 inside, 0 at the edge, over the cells' tenth of the box, the fade the border cells' light is given
 *  by so that they carry the light that lights every surface past both cascades). */
export const TV_FRAME_WGSL = wgslBlock(
  'TV_FRAME_WGSL',
  [],
  `${TRANSLUCENCY_FRAME.wgsl}
fn tvCellPoint(cascade:u32,cell:vec3f)->vec3f{return tv.corner[cascade].xyz+(cell+vec3f(0.5))*tv.scale[cascade].w;}
fn tvBorder(cascade:u32,uvw:vec3f)->f32{
 let cells=tv.corner[cascade].w;
 let faded=uvw*(1.0+4.0*cells)-vec3f(2.0*cells);
 let ramp=saturate((vec3f(0.5)-abs(faded-vec3f(0.5)))*10.0);
 return ramp.x*ramp.y*ramp.z;
}`,
)

/** A cell of the volume as the passes hold it (`TvTexel`): the ambient light's four channels and the directional light's three; and
 *  the slab of the volume's texture a cascade's kind of light lies in (`tvSlab`: ambient 0, directional 1; the slabs `TRANSLUCENCY_KINDS`
 *  to a cascade, `dim` slices each). */
export const TV_TEXEL_WGSL = wgslBlock(
  'TV_TEXEL_WGSL',
  [],
  `struct TvTexel{ambient:vec4f,directional:vec3f,}
fn tvSlab(cascade:u32,kind:u32)->u32{return cascade*${TRANSLUCENCY_KINDS}u+kind;}`,
)

/**
 * A SLAB OF A STACKED 3D TEXTURE SAMPLED (`stackedSample`): the texture holds `slabs` volumes of `depth` slices one after the other along its depth;
 * the point `uvw` (0 to 1 along each axis of one volume) is read in slab `slab` with the sampler `smp` — a hardware filter, the edge held —, the
 * depth held half a slice inside the slab so that the filter never mixes two. The translucency lighting volume and the translucency global
 * illumination volume both read their light so.
 */
export const STACKED_SAMPLE_WGSL = wgslBlock(
  'STACKED_SAMPLE_WGSL',
  [],
  `fn stackedSample(volume:texture_3d<f32>,smp:sampler,uvw:vec3f,depth:f32,slab:f32,slabs:f32)->vec4f{
 let z=clamp(uvw.z*depth,0.5,depth-0.5);
 return textureSampleLevel(volume,smp,vec3f(uvw.xy,(z+slab*depth)/(slabs*depth)),0.0);
}`,
)
