import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { visTriangle } from '../visWords.ts'
import {
  ARG_MAX_TRIANGLES,
  ARG_MAX_TRIANGLES_TWO_SIDED,
  SEED_SPLIT_LIMIT,
  TABLE_SIZE,
} from './contract.ts'
import { FLAG_DOUBLE } from '../types.ts'
import { CHILDREN_WGSL, QUEUE_WGSL } from './queueWgsl.ts'
import {
  BOX3,
  PATTERN_WGSL,
  boxGrownByDisplacement,
  coarseFactors,
  edgeFactors,
  patternOf,
  quarterRateDepth,
  sortedFactors,
  unpackCorner,
} from './patchWgsl.ts'
import { TESS_VIEW } from './viewWgsl.ts'

/**
 * WHAT THE SPLITTING DOES WITH A PATCH, over a view (`TessView`): the patch placed on its triangle
 * (`patchShape`) — its three corners, and the box they span grown by the displacement along normals
 * in the cone the three make, which the view judges (`patchSight` for the image,
 * `../../lighting/shadows/vsm/tessellation/` for a shadow map) —, then, for a patch the view lets
 * through, the edge factors of its corners in the world (`settlePatch`): one pattern holds it and it
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
    worldMatrix3,
    unitOrZero,
    visTriangle,
    unpackCorner,
    boxGrownByDisplacement,
    edgeFactors,
    quarterRateDepth,
    coarseFactors,
    sortedFactors,
    patternOf,
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
/** A patch the view lets through, queued again cut finer or listed visible; \`track\` notes the
 *  triangles a listed patch's pattern holds in the most the pass's state keeps for its row's kind
 *  (\`ARG_MAX_TRIANGLES\`, \`ARG_MAX_TRIANGLES_TWO_SIDED\`), which size the draws of the shadow maps; a
 *  two-sided row's patch is listed in the second list (\`listVisibleTwoSided\`), so that each draw launches
 *  its rows' patches alone. */
fn settlePatch(piece:vec4u,page:PageInfo,rec:DisplacementRecord,shape:PatchShape,view:TessView,track:bool){
 let c=shape.corner;
 let w0=(page.world*vec4f(c[0],1.0)).xyz;let w1=(page.world*vec4f(c[1],1.0)).xyz;let w2=(page.world*vec4f(c[2],1.0)).xyz;
 let depth=vec3f(dot(view.forward,w0-view.eye),dot(view.forward,w1-view.eye),dot(view.forward,w2-view.eye));
 let axes=worldMatrix3(page.world);
 let scale=sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
 let far=quarterRateDepth(max(-rec.bounds.x,rec.bounds.y),scale,view.edgesPerUnit,rec.bounds.z*tu.edgesPerPixel);
 let f=edgeFactors(mat3x3f(w0,w1,w2),depth,view.near,view.perspective,view.edgesPerUnit,tu.piecesPerEdge,far);
 if(max(f.x,max(f.y,f.z))>${TABLE_SIZE}.0){
  queueChildren(piece.x,shape.parent,min(coarseFactors(f),vec3f(${SEED_SPLIT_LIMIT}.0)),true);
  return;
 }
 let twoSided=track&&(page.flags&${FLAG_DOUBLE}u)!=0u;
 if(twoSided){listVisibleTwoSided(piece);}else{listVisible(piece);}
 if(track){
  let s=sortedFactors(f);
  let triangles=patternTriangles(patternAt(patternOf(s.factors,s.flip)));
  atomicMax(&tess[tu.args+select(${ARG_MAX_TRIANGLES}u,${ARG_MAX_TRIANGLES_TWO_SIDED}u,twoSided)],triangles);
 }
}`,
)
