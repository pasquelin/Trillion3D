import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { frameAround, outOfFrame } from '../../../../../math/src/wgsl/basis.ts'
import { sampleSphereEven } from '../../../../../math/src/wgsl/sampling.ts'
import { GGX_DISTRIBUTION_WGSL } from '../../../lighting/standardLighting.ts'
import { IRRADIANCE_TERMS } from '../../../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { MIP_ROUGHNESS_SLOPE, ROUGHEST_LEVEL } from './layout.ts'

/** The terms `from` to `to` (excluded) of the basis, as comma-separated WGSL read at the shader's
 *  unit `d` and its squares `sq`: each term's contract value times its polynomial, a difference
 *  parenthesised, the constant term alone. */
const harmonics = (from: number, to: number) =>
  IRRADIANCE_TERMS.slice(from, to)
    .map(({ contract, polynomial }, k) => {
      if (from + k === 0) return `${contract}`
      const factor = polynomial('d', 'sq')
      return `${contract}*${factor.includes('-') ? `(${factor})` : factor}`
    })
    .join(',')

/**
 * THE SKY LIGHT'S CUBE, AS ITS PROGRAMS READ IT: how a texel of a face is a direction, how the
 * cube's frame is the scene's, which roughness a mip stands for and which mip a roughness is read
 * at, and the samplings the filter and the harmonics are made of.
 *
 * A pixel's direction on face `face` is `faceDirection(uv, face)`, `uv` in `[-1, 1]` across the
 * face, `y` down the rows of the image: the very orientation of a cube texture's faces, so that a
 * cube sampled by that direction answers the texel it was written at. The frame is the cube's,
 * whose third axis is up; the scene's up is its second (`cubeToScene`, `sceneToCube`: a turn about
 * the first axis).
 *
 * The mips stand for roughnesses: mip `m` of a cube whose last mip is `L` stands for
 * `2^((MIP_ROUGHEST - (L - 1 - m)) / MIP_ROUGHNESS_SLOPE)` (`mipRoughness`), and a read of a
 * roughness inverts the law, the roughness held to 0.001 (`roughnessMip`).
 */
export const SKY_CUBE_WGSL = wgslBlock(
  'SKY_CUBE_WGSL',
  [PI],
  `
const MIP_ROUGHEST:f32=${ROUGHEST_LEVEL}.0;
const MIP_ROUGHNESS_SLOPE:f32=${MIP_ROUGHNESS_SLOPE};
fn faceDirection(uv:vec2f,face:u32)->vec3f{
 switch face{
  case 0u:{return vec3f(1.0,-uv.y,-uv.x);}
  case 1u:{return vec3f(-1.0,-uv.y,uv.x);}
  case 2u:{return vec3f(uv.x,1.0,uv.y);}
  case 3u:{return vec3f(uv.x,-1.0,-uv.y);}
  case 4u:{return vec3f(uv.x,-uv.y,1.0);}
  default:{return vec3f(-uv.x,-uv.y,-1.0);}
 }
}
fn cubeToScene(c:vec3f)->vec3f{return vec3f(c.x,c.z,-c.y);}
fn sceneToCube(s:vec3f)->vec3f{return vec3f(s.x,-s.z,s.y);}
/** The roughness mip \`mip\` stands for, of a cube whose last mip is \`lastMip\`. */
fn mipRoughness(mip:f32,lastMip:f32)->f32{
 let levelFromLast=lastMip-1.0-mip;
 return exp2((MIP_ROUGHEST-levelFromLast)/MIP_ROUGHNESS_SLOPE);
}
/** The mip a roughness is read at, of a cube whose last mip is \`lastMip\`. */
fn roughnessMip(roughness:f32,lastMip:f32)->f32{
 let levelFromLast=MIP_ROUGHEST-MIP_ROUGHNESS_SLOPE*log2(max(roughness,0.001));
 return lastMip-1.0-levelFromLast;
}
`,
)

/**
 * THE SAMPLINGS: a point of the low-discrepancy set of \`count\`, a direction of the cosine lobe,
 * a half vector of the GGX lobe, a direction of the sphere evenly, each about the third axis; the
 * nine harmonics' basis of a direction, in the cube's frame.
 */
export const SKY_SAMPLING_WGSL = wgslBlock(
  'SKY_SAMPLING_WGSL',
  [PI, GGX_DISTRIBUTION_WGSL, frameAround, outOfFrame, sampleSphereEven],
  `
/** Point \`index\` of \`count\`: the index over the count, then the index's bits reversed. */
fn lowDiscrepancy(index:u32,count:u32)->vec2f{
 return vec2f(fract(f32(index)/f32(count)),f32(reverseBits(index))*2.3283064365386963e-10);
}
fn sampleCosineLobe(e:vec2f)->vec3f{
 let phi=2.0*PI*e.x;
 let cosTheta=sqrt(e.y);
 let sinTheta=sqrt(1.0-cosTheta*cosTheta);
 return vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
/** The half vector of the GGX lobe of squared roughness-alpha \`alpha2\`. */
fn sampleGgxHalf(e:vec2f,alpha2:f32)->vec3f{
 let phi=2.0*PI*e.x;
 let cosTheta=sqrt((1.0-e.y)/(1.0+(alpha2-1.0)*e.y));
 let sinTheta=sqrt(1.0-cosTheta*cosTheta);
 return vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
/** The nine harmonics' basis at the unit \`d\`, as two \`vec4f\` and a scalar: terms 0 to 3, 4 to 7, 8. */
struct Harmonics{low:vec4f,mid:vec4f,high:f32,}
fn harmonicsBasis(d:vec3f)->Harmonics{
 let sq=d*d;
 var h:Harmonics;
 h.low=vec4f(${harmonics(0, 4)});
 h.mid=vec4f(${harmonics(4, 8)});
 h.high=${harmonics(8, 9)};
 return h;
}
`,
)
