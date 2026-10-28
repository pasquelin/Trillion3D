import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { patchBarycentrics, patternOf, sortedFactors, unpackCorner } from './patchWgsl.ts'
import { domainPoint, fadeLine, setDensity, uvDerivative } from './domainWgsl.ts'
import { CORNER_FACTORS_WGSL, TESS_VIEW, WORLD_SCALE_WGSL } from './viewWgsl.ts'

/** The height of the displacement at \`uv\`, read at the footprint \`step\`: the height map's — this
 *  default — unless the program lists the graph's height in its place (\`graphHeightWgsl\`), which is a
 *  graph's where the surface's record says so. */
const DICE_HEIGHT_MAP = wgslFn(
  'diceHeight',
  [],
  `fn diceHeight(rec:DisplacementRecord,uv:vec2f,step:f32)->f32{
 return dataSample(rec.map.x,uv,vec2f(step),vec2f(step),true).x;
}`,
  { weak: true },
)

/**
 * A PATCH TO DICE, over a view (`TessView`), as the dicing of the image and of the shadow maps both
 * read it: the source triangle's corners, normals and coordinates, its placement, the pattern the
 * edge factors of the patch's corners in the world pick (`dicePatch`), the corners of the patch in
 * the pattern's order, the fade of the displacement over depth and the material's density of each
 * the two texture-coordinate sets it reads, the height map's and the base map's, at the object's scale; then each vertex of the pattern (`diceVertex`): a point of the displaced
 * surface's domain with the height the map holds there, read at the level its micro-triangle's size
 * asks for. The program declares `tu`, the patterns (`PATTERN_WGSL`, or its plain twin where `tess`
 * is read-only), the data atlas (`dataSample`), the page geometry and `pageMaskSet`.
 */
export const DICE_PATCH_WGSL = wgslBlock(
  'DICE_PATCH_WGSL',
  [
    TESS_VIEW,
    DICE_HEIGHT_MAP,
    unpackCorner,
    CORNER_FACTORS_WGSL,
    WORLD_SCALE_WGSL,
    sortedFactors,
    patternOf,
    patchBarycentrics,
    fadeLine,
    domainPoint,
    setDensity,
    uvDerivative,
  ],
  `struct DicePatch{p:mat3x3f,normal:mat3x3f,uv:mat3x2f,world:mat4x4f,pattern:Pattern,ordered:mat3x3f,fade:vec2f,heightDensity:f32,maskDensity:f32,}
fn dicePatch(page:PageInfo,rec:DisplacementRecord,piece:vec4u,view:TessView,p:mat3x3f,nrm:mat3x3f,uv:mat3x2f)->DicePatch{
 let world=page.world;
 let parent=mat3x3f(unpackCorner(piece.y),unpackCorner(piece.z),unpackCorner(piece.w));
 let scale=worldScale(world);
 let sorted=sortedFactors(cornerFactors(world,p*parent,view,farDepth(rec,scale,view)));
 let pattern=patternAt(patternOf(sorted.factors,sorted.flip));
 let ordered=mat3x3f(parent[sorted.corners.x],parent[sorted.corners.y],parent[sorted.corners.z]);
 let fade=fadeLine(rec.scale,rec.bounds,scale,view.edgesPerUnit,tu.edgesPerPixel,view.perspective);
 return DicePatch(p,nrm,uv,world,pattern,ordered,fade,setDensity(rec.density,rec.densityHigh,scale,rec.map.y),setDensity(rec.density,rec.densityHigh,scale,pageMaskSet(page)));
}
struct DiceVertex{point:DomainPoint,height:f32,b:vec3f,}
/** Vertex \`v\` of the patch's pattern: its point of the domain, the map's height there and its weights on
 *  the source triangle. */
fn diceVertex(d:DicePatch,rec:DisplacementRecord,view:TessView,v:u32)->DiceVertex{
 let b=patchBarycentrics(d.ordered[0],d.ordered[1],d.ordered[2],patternVertex(d.pattern,v));
 let point=domainPoint(b,d.p,d.normal,d.uv,d.world,view.clip);
 let step=uvDerivative(point.clip.w,d.heightDensity,view.edgesPerUnit,tu.piecesPerEdge,view.perspective);
 return DiceVertex(point,diceHeight(rec,point.uv,step),b);
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
 let m=uvDerivative(at.point.clip.w,d.maskDensity,view.edgesPerUnit,tu.piecesPerEdge,view.perspective);
 return maskKeep(page,uv*at.b,dot(alpha,at.b),vec2f(m),vec2f(m));
}`,
)
