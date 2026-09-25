/**
 * The view AHEAD of the camera: what the camera cut also evaluates so the pages the camera is about
 * to need are asked for before they are on screen (#488).
 *
 * The host writes it in the second uniform block (`../uniforms.ts`) and raises `ahead` in the first:
 * the eye moved by its velocity over the horizon (`view`), inside a frustum widened by the angle it
 * turns meanwhile and pushed out by the distance it travels (`planes`,
 * `../../core/aheadView.ts`). A still camera sends none, and the cut is the one of before, bit for
 * bit.
 *
 * It is ONE descent, not two. A work entry of view 0 serves the camera, as always; a node or a page
 * the camera rejects is tried against the view ahead, and kept there it continues under view 1 —
 * which only this view ahead reads. So a node is visited once whatever the views that keep it,
 * every queue and list keeps its bound, and a page of view 1 never reaches the live list: it is
 * never drawn, only REQUESTED, in the lower tier (`../request.ts`). A light cut never raises the
 * flag, and its views keep their meaning.
 *
 * What the view ahead asks for fills at most half of the sample: the other half stays for the
 * camera's own requests, whose overflow alone declares the sample truncated (`snapshotWgsl.ts`).
 */
export const AHEAD_VIEW = 1;

export const DAG_AHEAD_WGSL = `const AHEAD_VIEW:u32=${AHEAD_VIEW}u;
fn aheadOn()->bool{return views[0u].ahead!=0u;}
/** The view-ahead frustum brought into the primitive's space as \`dagPrepare\` brings the camera's,
 *  then the same box test (\`outsidePlane\`). A primitive no camera culls is never outside it. */
fn outsideAhead(w:u32,bmin:vec3f,bmax:vec3f)->bool{
 if(unculledOf(w)){return false;}
 let m=transpose(worlds[w]);
 for(var i=0u;i<6u;i++){if(outsidePlane(m*views[AHEAD_VIEW].planes[i],bmin,bmax)){return true;}}
 return false;
}
/** \`levelStep\`'s verdict under the view ahead: inside its frustum, not too fine, not too coarse. */
fn keepsAhead(node:CullNode,w:u32)->bool{
 vi=AHEAD_VIEW;
 if(outsideAhead(w,node.minimum,node.maximum)){return false;}
 let e=views[vi].view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(node.maxParentError>=0.0&&projected(node.maxParentError,node.sphere,e,stretch,focal)<=views[vi].pixelError){return false;}
 return !floorPrunes(node.open,node.floorSphere,node.errorFloor,e,stretch,focal);
}
/** A node the camera rejected, tried against the view ahead. */
fn descendAhead(src:u32,node:CullNode,w:u32){
 if(aheadOn()&&keepsAhead(node,w)){descend(src,node);}
}
/** A page the camera does not request, requested ahead when the view ahead selects it. */
fn wantAhead(i:u32,w:u32,r:u32,cluster:Cluster){
 // Past half the sample nothing more is emitted: the tests below would be spent for nothing.
 if(!aheadOn()||aheadFull()){return;}
 vi=AHEAD_VIEW;
 if((cluster.flags&2u)!=0u||outsideAhead(w,boxMin(r),boxMax(r))){return;}
 let e=views[vi].view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,views[vi].pixelError)){return;}
 emitAhead(i,replacementPixels(cluster,e,stretch,focal));
}
`;
