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
const DOMAIN_POINT = wgslStruct(
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
export const fadeLine = wgslFn(
  'fadeLine',
  [],
  `fn fadeLine(scaleRec:vec4f,bounds:vec4f,scale:f32,edgesPerUnit:f32,edgesPerPixel:f32,perspective:bool)->vec2f{
 if(!(scaleRec.z>0.0&&scaleRec.w>0.0)){return vec2f(0.0,1.0);}
 let stop=edgesPerPixel*max(scaleRec.w,0.0001);
 let start=edgesPerPixel*max(scaleRec.z,scaleRec.w+0.0001);
 let reach=max(-bounds.x,bounds.y)*edgesPerUnit*scale;
 let wholeDepth=reach/start;let goneDepth=reach/stop;
 let slope=1.0/(wholeDepth-goneDepth);
 let offset=-goneDepth*slope;
 if(!perspective){return vec2f(0.0,saturate(slope+offset));}
 return vec2f(slope,offset);
}`,
)

/** How far `point` moves along its normal for the height `height` of the map, in 0 to 1:
 *  `(height - center) * magnitude`, faded by the depth of the point, the centre and magnitude the
 *  record's (`scaleRec`, `DISPLACEMENT_RECORD`). In a shadow map (`shadow`) a point the fade has not
 *  left whole takes the least displacement, `-center * magnitude`, instead of the faded one: the
 *  surface does not shadow itself where it fades out. */
export const pointDisplacement = wgslFn(
  'pointDisplacement',
  [DOMAIN_POINT],
  `fn pointDisplacement(point:DomainPoint,height:f32,scaleRec:vec4f,fade:vec2f,shadow:bool)->f32{
 let amount=saturate(point.clip.w*fade.x+fade.y);
 if(shadow&&amount<1.0){return -scaleRec.y*scaleRec.x;}
 return (saturate(height)-scaleRec.y)*scaleRec.x*amount;
}`,
)

/** The clip position of `point` displaced by the height `height` of the map along its normal
 *  (`pointDisplacement`). */
export const displacedClip = wgslFn(
  'displacedClip',
  [DOMAIN_POINT, pointDisplacement],
  `fn displacedClip(point:DomainPoint,height:f32,scaleRec:vec4f,fade:vec2f,viewProj:mat4x4f)->vec4f{
 let distance=pointDisplacement(point,height,scaleRec,fade,false);
 return viewProj*vec4f(point.world+point.normal*distance,1.0);
}`,
)

/** The density of texture-coordinate set `set` (`DISPLACEMENT_RECORD`'s `density`, the first four sets,
 *  and `densityHigh`, the others) at the object's `scale`: the units of the world one unit of the set
 *  covers; one where the compiler measured none. */
export const setDensity = wgslFn(
  'setDensity',
  [],
  `fn setDensity(low:vec4f,high:vec4f,scale:f32,uvSet:u32)->f32{
 let measured=select(low[uvSet&3u],high[uvSet&3u],uvSet>=4u);
 return select(1.0,measured,measured>0.0)*scale;
}`,
)

/** How far the texture coordinate moves across one micro-triangle's edge, which the height map is
 *  read at the level of: the edge's pixels over the pixels a unit of the map's coordinate covers
 *  at `depth`, the same at every point of a surface so that the micro-triangles of two triangles
 *  meet at the same level. `perUv` is the object's units one unit of the coordinate covers, at the
 *  object's scale: the material's density of the set (`DISPLACEMENT_RECORD`), never a triangle's. */
export const uvDerivative = wgslFn(
  'uvDerivative',
  [],
  `fn uvDerivative(depth:f32,perUv:f32,edgesPerUnit:f32,piecesPerEdge:f32,perspective:bool)->f32{
 return select(1.0,depth,perspective)/(perUv*edgesPerUnit*piecesPerEdge);
}`,
)
