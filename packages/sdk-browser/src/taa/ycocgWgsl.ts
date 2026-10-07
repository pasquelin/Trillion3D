import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
/** YCoCg, the space where the neighbour box tightens best around the colour. */
export const YCOCG_WGSL = wgslBlock(
  'YCOCG_WGSL',
  [],
  `
fn toYcocg(c:vec3f)->vec3f{return vec3f(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn fromYcocg(c:vec3f)->vec3f{return vec3f(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}`,
)
