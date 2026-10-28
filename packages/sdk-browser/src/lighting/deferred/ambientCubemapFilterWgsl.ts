import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { CUBE_FILTER_WGSL } from './ambientCubemapFilterText.ts'

/**
 * THE AMBIENT CUBEMAP'S MIP CHAIN ON THE GPU, built once for a cube (`ambientCubemapFrame.ts`): two kernels, the cube's box-filtered
 * mips (`averageCubeMip`: each texel of a mip the mean of four of the one above, kept in full floats) and the angular filter itself
 * (`filterCubeMip`: each texel of a mip of the chain the weighed mean of the texels of a box-filtered mip within a cone about its
 * direction). The cone, the mip it is taken from and the width of the weights of each mip are the processor's
 * (`ambientCubemapLevelCone`, `sdk-core/src/lighting/ambientCubemapMips.ts`; the processor's filter this text is tested against is
 * `ambientCubemapMips.fixture.ts`), the faces' signed permutations too (`CUBE_FACES_WORDS`).
 *
 * A texel's cone walks the six faces' quadtrees of the source mip depth first, a block entered only where its bounding sphere meets the
 * cone (`cubeSphereMeetsCone`), a stack of packed blocks (`x`, `y` and the side of the block in 10, 10 and 11 bits) holding at most three
 * a level; a texel of the source within the cone adds its colour times a smoothstep of how near the cone's axis it lies. A texel nothing
 * lies within the cone of is left black. The mean is times the scale the cube was fitted to a half float by, held to the half float's greatest.
 */

/** The half float's greatest finite number: the filtered colour is held to it. */
const HALF_MAX = 65504

/** The six faces' signed permutations (`AMBIENT_CUBEMAP_FACE_PERM`, `AMBIENT_CUBEMAP_FACE_SIGN`), a `vec4` each, in a uniform of this many words:
 *  the six `perm`s, then the six `sign`s. */
export const CUBE_FACES_WORDS = 48

/** The filter's entry: a mip's texels of a face, `span.y` rows from row `counts.w`, each the cone's mean times the scale. */
export const CUBE_FILTER_ENTRY = 'filterCubeMip'

/** The angular filter of one chunk of rows of one face of one mip. */
export const cubeFilterShader = () =>
  wgslProgram(
    `@compute @workgroup_size(8,8,1)
fn ${CUBE_FILTER_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let side=cubeFilter.counts.x;
 if(id.x>=side||id.y>=cubeFilter.span.y){return;}
 let face=cubeFilter.counts.z;
 let y=cubeFilter.counts.w+id.y;
 let u=(f32(id.x)+0.5)*(1.0/f32(side))*2.0-1.0;
 let v=(f32(y)+0.5)*(1.0/f32(side))*2.0-1.0;
 let mean=cubeConeMean(cubeDirection(face,u,v));
 textureStore(cubeFiltered,vec2u(id.x,y),face,vec4f(min(mean*cubeFilter.scale,vec3f(${HALF_MAX}.0)),1.0));
}`,
    [CUBE_FILTER_WGSL],
  )

/** The averaging's entry: a mip of the box-filtered chain from the one above. */
export const CUBE_AVERAGE_ENTRY = 'averageCubeMip'

/** Where the averaging's bindings lie in group 0. */
export const CUBE_AVERAGE_BINDINGS = { source: 0, averaged: 1 } as const

/** The box filter of one mip of the cube's chain: each texel the mean of four of the mip above (kept in full floats: the chain is the source of the angular filter). */
export const cubeAverageShader = () =>
  `@group(0) @binding(${CUBE_AVERAGE_BINDINGS.source}) var averageSource:texture_2d_array<f32>;
@group(0) @binding(${CUBE_AVERAGE_BINDINGS.averaged}) var averaged:texture_storage_2d_array<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${CUBE_AVERAGE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(averaged).x;
 if(id.x>=side||id.y>=side){return;}
 let at=vec2i(id.xy*2u);
 let sum=textureLoad(averageSource,at,id.z,0)+textureLoad(averageSource,at+vec2i(1,0),id.z,0)+textureLoad(averageSource,at+vec2i(0,1),id.z,0)+textureLoad(averageSource,at+vec2i(1,1),id.z,0);
 textureStore(averaged,id.xy,id.z,sum*0.25);
}`
