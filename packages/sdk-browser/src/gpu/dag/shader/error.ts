/**
 * Screen error of the DAG selection kernel, in WGSL: sdk-core's `screenErrorBound` (proof at the
 * formula site, `screenErrorBound.ts`), same operands and same order, in f32. CPU mirror:
 * `projectedError` from `../oracle/math.fixture.ts`. WGSL module declarations are read in any order:
 * this fragment is added to the text of `shader.ts`.
 *
 * `REFERENCE_ERROR` is the EXPERIMENT switch described in `screenErrorVariant.ts`: a module
 * constant, false in the shipped text — the default shader is therefore unchanged, the branch
 * being eliminated at compile time. `withScreenErrorVariant` sets it true for the campaign that
 * measures the external-reference metric, exact mirror of `referenceScreenError`.
 */
import { CLUSTER_LEVEL_SHIFT } from '../clusterFlags.ts';
import type { ScreenErrorVariant } from '../../../../../sdk-core/src/index.ts';
import { REFERENCE_ERROR_DECL } from './referenceErrorDecl.ts';
import { LINK_ERROR, LINK_PAGE, LINK_WORDS } from '../worldLinks.ts';
import { SELECTION_NONE } from '../../core/selection.ts';

export const DAG_ERROR_WGSL = `
${REFERENCE_ERROR_DECL}
/** Upper bound of the screen displacement of any point of the sphere, grown by the primitive's
 *  deformation reach (\`deformReach\`, #357), moved by at most \`error\`:
 *  minimum depth m, distance to the axis l, radius and error stretched rho and delta, written on
 *  the clip weight w = p*depth+(1-p) of the projection (\`views[vi].perspective\`, p):
 *  E = (delta*f/w(m))*(sqrt(w(m)^2+(p*(l+rho))^2)/w(m-delta)) ; near plane reached: INF.
 *  Under \`REFERENCE_ERROR\`, the external reference's simple projection: delta*f/w(depth). */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 let p=views[vi].perspective;let flat=1.0-p;
 if(REFERENCE_ERROR){
  let depth=p*-v.z+flat;
  if(!(depth>p*views[vi].near)){return INF;}
  let delta=error*stretch;
  return (delta*focal)/depth;
 }
 let reach=(sphere.w+deformReach)*stretch;let shift=error*stretch;
 let nearest=p*(-v.z-reach)+flat;let closest=nearest-p*shift;let side=p*(sqrt(v.x*v.x+v.y*v.y)+reach);
 if(!(closest>p*views[vi].near)){return INF;}
 let slant=sqrt(nearest*nearest+side*side);
 if(!(slant>=nearest&&slant<INF)){return INF;}
 return ((shift*focal)/nearest)*(slant/closest);
}
/** The two screen errors the cut rule compares, projected once: its replacement's (\`x\`, the
 *  parent's) and its own (\`y\`). */
fn clusterPixels(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32)->vec2f{
 let own=cluster.lodError+select(0.0,2.0*deformReach,(cluster.flags>>${CLUSTER_LEVEL_SHIFT}u)>0u);
 let parent=select(cluster.parentError,cluster.parentError+2.0*deformReach,cluster.parentError>=0.0);
 return vec2f(projected(parent,cluster.parentSphere,e,stretch,focal),projected(own,cluster.sphere,e,stretch,focal));
}
/** \`clusterPixels\` of record \`r\` on placement \`w\`: a root linked to its world rank whose parent
 *  stands (\`linkHolds\`) projects that parent, in the placement's frame (\`../worldLinks.ts\`). */
fn pagePixels(w:u32,r:u32,cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32)->vec2f{
 let pixels=clusterPixels(cluster,e,stretch,focal);let at=linkOf(w,r);
 if(!linkHolds(at)){return pixels;}
 let sphere=vec4f(linkWord(at,0u),linkWord(at,1u),linkWord(at,2u),linkWord(at,3u));
 return vec2f(projected(linkWord(at,${LINK_ERROR}u)+2.0*deformReach,sphere,e,stretch,focal),pixels.y);
}
/** The link of record \`r\`'s root on placement \`w\`, \`LINK_NONE\` unless both name one. */
fn linkOf(w:u32,r:u32)->u32{return linkAt(linkBaseOf(w),clusterAt(r).root);}
fn linkAt(base:u32,root:u32)->u32{return select(base+root*${LINK_WORDS}u,LINK_NONE,base==LINK_NONE||root==LINK_NONE);}
/** Whether link \`at\` names a world rank whose parent stands: ready, its group's members held. A
 *  world rank not ready stands for no parent, and its root reads none, as an unlinked root. */
fn linkHolds(at:u32)->bool{return at!=LINK_NONE&&linkedReady(coldAt(at+${LINK_PAGE}u));}
fn linkedReady(page:u32)->bool{return page!=LINK_NONE&&(views[0u].residentCut==0u||isResident(page));}
fn linkWord(at:u32,k:u32)->f32{return bitcast<f32>(coldAt(at+k));}
const LINK_NONE:u32=${SELECTION_NONE}u;
/** The cluster the cut wants at \`threshold\`, on its \`clusterPixels\`: the rule with everything resident. */
fn selects(pixels:vec2f,threshold:f32)->bool{return drawsCluster(true,pixels.x,pixels.y,true,threshold);}
fn focalPixels()->f32{return max(views[vi].pixelScale.x,views[vi].pixelScale.y);}
`;

/**
 * Shader text for a given variant: returned as-is for ours, a single declaration returned for
 * the external-reference one. Nothing else changes by a character.
 */
export function withScreenErrorVariant(code: string, variant: ScreenErrorVariant): string {
  if (variant !== 'reference') return code;
  const at = code.indexOf(REFERENCE_ERROR_DECL);
  if (at < 0) throw new Error('REFERENCE_ERROR declaration missing from the shader');
  return (
    code.slice(0, at) +
    'const REFERENCE_ERROR:bool=true;' +
    code.slice(at + REFERENCE_ERROR_DECL.length)
  );
}
