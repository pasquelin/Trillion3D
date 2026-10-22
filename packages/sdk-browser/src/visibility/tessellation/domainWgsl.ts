import { wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/**
 * A point of a displaced triangle, as the dicing evaluates it: the barycentrics `b` of the point on
 * the source triangle, which has the corners `p` (local space), the normals `n` and the texture
 * coordinates `uv`; `world` takes the local space to the world and `viewProj` the world to the clip.
 * The point is the triangle's own there — the corners and the normal weighed by `b` — and the
 * displacement pushes it along that normal, as long as the world's matrix makes it: the clip
 * position of the displaced point is the clip position of the base point and of the normal, the
 * normal times the displacement added, which a world and a view are linear in.
 */

/** A point of the source triangle before the displacement: in the world, its normal in the world
 *  (the world's matrix applied, so its length follows the object's scale), its texture coordinate
 *  and its clip position. */
export const DOMAIN_POINT = wgslStruct(
  'DomainPoint',
  [],
  'struct DomainPoint{world:vec3f,normal:vec3f,uv:vec2f,clip:vec4f,}',
)

/** The point `b` of the triangle `(p, n, uv)`: the weighted corners, the normal not made unit —
 *  its length is what the interpolation leaves —, the texture coordinate. */
export const domainPoint = wgslFn(
  'domainPoint',
  [DOMAIN_POINT],
  `fn domainPoint(b:vec3f,p:mat3x3f,n:mat3x3f,uv:mat3x2f,world:mat4x4f,viewProj:mat4x4f)->DomainPoint{
 let w=(world*vec4f(p*b,1.0)).xyz;
 return DomainPoint(w,(world*vec4f(n*b,0.0)).xyz,uv*b,viewProj*vec4f(w,1.0));
}`,
)

/**
 * The fade of a displacement over the depth, as a line `slope * depth + offset` to be saturated:
 * where the largest displacement (`absMax`, at `scale`) subtends `fadeStart` pixels it is whole,
 * where it subtends `fadeStop` it is gone — both in edges: pixels over the threshold. Constant in an
 * orthographic view, whole (zero slope, offset one) for a displacement that never fades.
 */
export const displacementFade = wgslFn(
  'displacementFade',
  [],
  `fn displacementFade(scaleRec:vec4f,bounds:vec4f,scale:f32,lodScale:f32,edgesPerPixel:f32,perspective:bool)->vec2f{
 if(!(scaleRec.z>0.0&&scaleRec.w>0.0)){return vec2f(0.0,1.0);}
 let stop=edgesPerPixel*max(scaleRec.w,0.0001);
 let start=edgesPerPixel*max(scaleRec.z,scaleRec.w+0.0001);
 let reach=max(-bounds.x,bounds.y)*lodScale*scale;
 let startDepth=reach/start;let stopDepth=reach/stop;
 let slope=1.0/(startDepth-stopDepth);
 let offset=-stopDepth*slope;
 if(!perspective){return vec2f(0.0,saturate(slope+offset));}
 return vec2f(slope,offset);
}`,
)

/** The clip position of `point` displaced by the height `height` of the map, in 0 to 1, along its
 *  normal: `(height - center) * magnitude`, faded by the depth of the point, the centre and
 *  magnitude the record's (`scaleRec`, `DISPLACEMENT_RECORD`). */
export const displacedClip = wgslFn(
  'displacedClip',
  [DOMAIN_POINT],
  `fn displacedClip(point:DomainPoint,height:f32,scaleRec:vec4f,fade:vec2f,viewProj:mat4x4f)->vec4f{
 let amount=saturate(point.clip.w*fade.x+fade.y);
 let distance=(saturate(height)-scaleRec.y)*scaleRec.x*amount;
 return viewProj*vec4f(point.world+point.normal*distance,1.0);
}`,
)

/** How far the texture coordinate moves across one micro-triangle's edge, which the height map is
 *  read at the level of: the edge's pixels over the pixels a unit of the map's coordinate covers
 *  at `depth`, the same at every point of a triangle so that its neighbours read the same level.
 *  `perUv` is the triangle's world length of one unit of the coordinate (`worldPerUv`). */
export const uvDerivative = wgslFn(
  'uvDerivative',
  [],
  `fn uvDerivative(depth:f32,perUv:f32,lodScale:f32,invDiceRate:f32,perspective:bool)->f32{
 return select(1.0,depth,perspective)/(perUv*lodScale*invDiceRate);
}`,
)

/** The world length of one unit of a triangle's texture coordinate: the root of its world area
 *  over its area in the coordinate; the least a float holds where the coordinate is flat. */
export const worldPerUv = wgslFn(
  'worldPerUv',
  [],
  `fn worldPerUv(w:mat3x3f,uv:mat3x2f)->f32{
 let world=length(cross(w[1]-w[0],w[2]-w[0]));
 let flat=abs((uv[1].x-uv[0].x)*(uv[2].y-uv[0].y)-(uv[1].y-uv[0].y)*(uv[2].x-uv[0].x));
 return max(sqrt(world/max(flat,1e-20)),1e-6);
}`,
)
