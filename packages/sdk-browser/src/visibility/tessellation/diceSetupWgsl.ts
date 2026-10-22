import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { PAGE_UV_SET_WGSL } from '../shader/pageUvSetWgsl.ts'
import {
  edgeFactors,
  patchBarycentrics,
  patternOf,
  quarterRateDepth,
  sortedFactors,
  unpackCorner,
} from './patchWgsl.ts'
import { domainPoint, fadeLine, setDensities, uvDerivative } from './domainWgsl.ts'
import { TESS_VIEW } from './viewWgsl.ts'

/** The coordinate a height map is read at, at the vertex `vertex` of a page: the texture set the
 *  displacement names where the geometry stores it, the first set else (`pageUvSet`). */
export const DISPLACE_UV = wgslBlock(
  'DISPLACE_UV_WGSL',
  [PAGE_UV_SET_WGSL],
  `fn displaceUv(page:PageInfo,h:ClusterHeader,vertex:u32,uvSet:u32)->vec2f{
 if(uvSet!=0u&&pageHasUvSet(page,h,uvSet)){return pageUvSet(page,h,vertex,uvSet,normalTexels());}
 return pageUv(page,h,vertex);
}`,
)

/**
 * A PATCH TO DICE, over a view (`TessView`), as the dicing of the image and of the shadow maps both
 * read it: the source triangle's corners, normals and coordinates, its placement, the pattern the
 * edge factors of the patch's corners in the world pick (`dicePatch`), the corners of the patch in
 * the pattern's order, the fade of the displacement over depth and the material's density of each
 * texture-coordinate set at the object's scale; then each vertex of the pattern (`diceVertex`): a point of the displaced
 * surface's domain with the height the map holds there, read at the level its micro-triangle's size
 * asks for. The program declares `tu`, the patterns (`PATTERN_WGSL`, or its plain twin where `tess`
 * is read-only), the data atlas (`dataSample`) and the page geometry.
 */
export const DICE_PATCH_WGSL = wgslBlock(
  'DICE_PATCH_WGSL',
  [
    TESS_VIEW,
    worldMatrix3,
    unpackCorner,
    edgeFactors,
    quarterRateDepth,
    sortedFactors,
    patternOf,
    patchBarycentrics,
    fadeLine,
    domainPoint,
    setDensities,
    uvDerivative,
  ],
  `struct DicePatch{p:mat3x3f,normal:mat3x3f,uv:mat3x2f,world:mat4x4f,pattern:Pattern,ordered:mat3x3f,fade:vec2f,density:vec4f,}
fn dicePatch(page:PageInfo,rec:DisplacementRecord,piece:vec4u,view:TessView,p:mat3x3f,nrm:mat3x3f,uv:mat3x2f)->DicePatch{
 let world=page.world;
 let parent=mat3x3f(unpackCorner(piece.y),unpackCorner(piece.z),unpackCorner(piece.w));
 let c0=(world*vec4f(p*parent[0],1.0)).xyz;let c1=(world*vec4f(p*parent[1],1.0)).xyz;let c2=(world*vec4f(p*parent[2],1.0)).xyz;
 let depth=vec3f(dot(view.forward,c0-view.eye),dot(view.forward,c1-view.eye),dot(view.forward,c2-view.eye));
 let axes=worldMatrix3(world);
 let scale=sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
 let far=quarterRateDepth(max(-rec.bounds.x,rec.bounds.y),scale,view.edgesPerUnit,rec.bounds.z*tu.edgesPerPixel);
 let sorted=sortedFactors(edgeFactors(mat3x3f(c0,c1,c2),depth,view.near,view.perspective,view.edgesPerUnit,tu.piecesPerEdge,far));
 let pattern=patternAt(patternOf(sorted.factors,sorted.flip));
 let ordered=mat3x3f(parent[sorted.corners.x],parent[sorted.corners.y],parent[sorted.corners.z]);
 let fade=fadeLine(rec.scale,rec.bounds,scale,view.edgesPerUnit,tu.edgesPerPixel,view.perspective);
 return DicePatch(p,nrm,uv,world,pattern,ordered,fade,setDensities(rec.density,scale));
}
struct DiceVertex{point:DomainPoint,height:f32,b:vec3f,}
/** Vertex \`v\` of the patch's pattern: its point of the domain, the map's height there and its weights on
 *  the source triangle. */
fn diceVertex(d:DicePatch,rec:DisplacementRecord,view:TessView,v:u32)->DiceVertex{
 let b=patchBarycentrics(d.ordered[0],d.ordered[1],d.ordered[2],patternVertex(d.pattern,v));
 let point=domainPoint(b,d.p,d.normal,d.uv,d.world,view.clip);
 let step=uvDerivative(point.clip.w,d.density[rec.map.y],view.edgesPerUnit,tu.piecesPerEdge,view.perspective);
 return DiceVertex(point,dataSample(rec.map.x,point.uv,vec2f(step),vec2f(step),true).x,b);
}`,
)

/**
 * THE CUTOUT OF A MASKED ROW AT A DICED VERTEX (`dicedKept`): the row's base-map coordinate and
 * vertex alpha of its three corners weighed by the vertex's own weights on the source triangle,
 * read by the rasters' own `maskKeep` at the level the micro-triangles' size asks for — the density
 * of the coordinate set the base map reads. The micro-triangles that use a vertex it does not keep
 * are not drawn: the cutout is judged at the vertices, never at the pixels. Listed by the programs
 * that dice a masked row, which declare `maskKeep` and `pageMaskSet`.
 */
export const DICE_CUTOUT_WGSL = wgslBlock(
  'DICE_CUTOUT_WGSL',
  [uvDerivative],
  `fn dicedKept(page:PageInfo,d:DicePatch,view:TessView,at:DiceVertex,uv:mat3x2f,alpha:vec3f)->bool{
 let m=uvDerivative(at.point.clip.w,d.density[pageMaskSet(page)],view.edgesPerUnit,tu.piecesPerEdge,view.perspective);
 return maskKeep(page,uv*at.b,dot(alpha,at.b),vec2f(m),vec2f(m));
}`,
)
