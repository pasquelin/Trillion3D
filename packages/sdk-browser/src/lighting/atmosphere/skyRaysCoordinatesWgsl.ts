import { INVERSE_TWO_PI, TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_RAYS } from './layout.ts'

/** The table's two mappings, pure: the direction a texel stands for, and the table coordinates
 *  of a direction above the horizon, in texels, a texel's centre on a whole number. */
export const SKY_RAYS_COORDINATES_WGSL = wgslBlock(
  'SKY_RAYS_COORDINATES_WGSL',
  [TWO_PI, INVERSE_TWO_PI],
  `const SKY_RAYS_AZIMUTH:u32=${SKY_RAYS.azimuth}u;
const SKY_RAYS_ELEVATION:u32=${SKY_RAYS.elevation}u;
fn skyRaysDirection(texel:vec2u)->vec3f{
 let uv=(vec2f(texel)+0.5)/vec2f(${SKY_RAYS.azimuth}.0,${SKY_RAYS.elevation}.0);
 let phi=(uv.x-0.5)*TWO_PI;
 let y=uv.y*uv.y;
 let ring=sqrt(max(0.0,1.0-y*y));
 return vec3f(ring*cos(phi),y,ring*sin(phi));
}
fn skyRaysCoordinates(d:vec3f)->vec2f{
 let across=vec2f(d.x,d.z);
 // Straight up there is no azimuth: any one gives the same sky.
 let phi=select(0.0,atan2(across.y,across.x),dot(across,across)>1e-12);
 return vec2f((phi*INVERSE_TWO_PI+0.5)*${SKY_RAYS.azimuth}.0-0.5,sqrt(saturate(d.y))*${SKY_RAYS.elevation}.0-0.5);
}`,
)
