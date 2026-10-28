import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { visTriangle } from '../visWords.ts'
import { SEED_SPLIT_LIMIT, TABLE_SIZE } from './contract.ts'
import { CHILDREN_WGSL, QUEUE_WGSL } from './queueWgsl.ts'
import {
  BOX3,
  PATTERN_WGSL,
  boxGrownByDisplacement,
  coarseFactors,
  unpackCorner,
} from './patchWgsl.ts'
import { CORNER_FACTORS_WGSL, TESS_VIEW, WORLD_SCALE_WGSL } from './viewWgsl.ts'

/**
 * WHAT THE SPLITTING DOES WITH A PATCH, over a view (`TessView`): the patch placed on its triangle
 * (`patchShape`) — its three corners, and the box they span grown by the displacement along normals
 * in the cone the three make, which the view judges (`patchSight` for the image,
 * `../../lighting/shadows/vsm/tessellation/` for a shadow map) —, then, for a patch the view lets
 * through, the edge factors of its corners in the world (`patchFactors`, `settlePatch`): one pattern holds it and it
 * goes to the visible list as it is, or a factor past `TABLE_SIZE` cuts it by the pattern of its
 * factors over `TABLE_SIZE`, held to `SEED_SPLIT_LIMIT`, the children left for the next level
 * (`queueChildren`). The program declares `pages`, the page geometry, `tess` and `tu`.
 */
export const PATCH_SHAPE_WGSL = wgslBlock(
  'PATCH_SHAPE_WGSL',
  [
    QUEUE_WGSL,
    CHILDREN_WGSL,
    PATTERN_WGSL,
    TESS_VIEW,
    BOX3,
    unitOrZero,
    visTriangle,
    unpackCorner,
    boxGrownByDisplacement,
    CORNER_FACTORS_WGSL,
    WORLD_SCALE_WGSL,
    coarseFactors,
  ],
  `/** A patch on its triangle: its corners in the row's space, its barycentrics on the triangle (the
 *  columns) and the box its displaced points lie in. */
struct PatchShape{corner:mat3x3f,parent:mat3x3f,box:Box3,}
fn patchShape(page:PageInfo,h:ClusterHeader,rec:DisplacementRecord,piece:vec4u)->PatchShape{
 let corners=pageTriangle(page,h,visTriangle(piece.x));
 let position=pageTrianglePositions(page,h,corners);
 let normal=mat3x3f(pageNormal(page,h,corners.x),pageNormal(page,h,corners.y),pageNormal(page,h,corners.z));
 let parent=mat3x3f(unpackCorner(piece.y),unpackCorner(piece.z),unpackCorner(piece.w));
 let c0=position*parent[0];let c1=position*parent[1];let c2=position*parent[2];
 let n0=unitOrZero(normal*parent[0]);let n1=unitOrZero(normal*parent[1]);let n2=unitOrZero(normal*parent[2]);
 let axis=unitOrZero(n0+n1+n2);
 let cone=min(dot(axis,n0),min(dot(axis,n1),dot(axis,n2)));
 let span=Box3(min(c0,min(c1,c2)),max(c0,max(c1,c2)));
 return PatchShape(mat3x3f(c0,c1,c2),parent,boxGrownByDisplacement(axis,cone,rec.bounds.x,rec.bounds.y,span));
}
/** The factors of a patch's three edges in the view \`view\`: its corners in the world, their depths, and the depth past which an edge is
 *  cut a quarter as finely (\`quarterRateDepth\`). */
fn patchFactors(page:PageInfo,rec:DisplacementRecord,shape:PatchShape,view:TessView)->vec3f{
 let far=farDepth(rec,worldScale(page.world),view);
 return cornerFactors(page.world,shape.corner,view,far);
}
/** A patch the view lets through, whose edge factors \`f\` are known (\`patchFactors\`): queued again
 *  cut finer or listed visible, in the list of the dicing's \`layer\` (the image's is 0). */
fn settleFactored(piece:vec4u,shape:PatchShape,f:vec3f,layer:u32){
 if(max(f.x,max(f.y,f.z))>${TABLE_SIZE}.0){
  queueChildren(piece.x,shape.parent,min(coarseFactors(f),vec3f(${SEED_SPLIT_LIMIT}.0)),true);
  return;
 }
 listVisible(piece,layer);
}
/** A patch the view lets through, judged by its factors in \`view\` (\`patchFactors\`) and settled. */
fn settlePatch(piece:vec4u,page:PageInfo,rec:DisplacementRecord,shape:PatchShape,view:TessView,layer:u32){
 settleFactored(piece,shape,patchFactors(page,rec,shape,view),layer);
}`,
)
