import { CONE_LENGTH_RATIO, CONE_ORTHO_EPS, HALF_PI } from '../../../../../sdk-core/src/index.ts'
import {
  absoluteSum3,
  invTranspose3Apply,
  isFiniteScale,
} from '../../../../../math/src/wgsl/inverseTranspose.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * The normal-cone rejection of the DAG selection kernel, and the per-page word that caches it with
 * the cut rule's two comparisons (`coneCache`). Added to the text of `shader.ts`.
 */
export const DAG_CONE_WGSL = wgslBlock(
  'DAG_CONE_WGSL',
  [invTranspose3Apply, absoluteSum3, isFiniteScale],
  `/** GPU mirror of \`isConformal\` (../../../page/cone/cone.ts): 3x3 divided by the sum of its absolute values,
 *  relative tolerances only; null, infinite or NaN sum (read at the bit): cluster kept. */
fn isConformal(m:mat3x3f)->bool{
 let t=absoluteSum3(m);
 if(!isFiniteScale(t)){return false;}
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let lx2=dot(a,a);let ly2=dot(b,b);let lz2=dot(c,c);
 let maxl=max(lx2,max(ly2,lz2));let minl=min(lx2,min(ly2,lz2));
 if(maxl>minl*${wgslF32(CONE_LENGTH_RATIO)}){return false;}
 let eps=maxl*${wgslF32(CONE_ORTHO_EPS)};
 return abs(dot(a,b))<=eps&&abs(dot(a,c))<=eps&&abs(dot(b,c))<=eps;
}
/** The camera as one homogeneous point of the render frame (\`EngineCamera.viewPoint\`): the origin
 *  under a perspective projection, the way back — the view's third row — under an orthographic one. */
fn viewPoint()->vec4f{
 let back=vec3f(views[vi].view[0].z,views[vi].view[1].z,views[vi].view[2].z);
 return vec4f(back*(1.0-views[vi].perspective),views[vi].perspective);
}
/** GPU mirror of \`coneCullsPageWith\` (../../../page/cone/cone.ts): same tolerances (packages/math/src/geometry/cone.ts), same operands.
 *  \`worlds[w]\` is a world matrix of the RENDER FRAME, where the camera is the origin: the vector from
 *  the box centre to the eye is the opposite of that centre, and subtracting two distant positions
 *  no longer happens. Same geometry as the CPU mirror, which works in absolute world space.
 *  Its conformity and normal matrix are the ones \`dagPrepare\` prepared for primitive \`w\`
 *  (\`primitiveWgsl.ts\`): the same verdict and the same \`inverseTranspose3\` as on its 3x3. */
fn coneRejectsBox(cone:vec4f,bmin:vec3f,bmax:vec3f,w:u32)->bool{
 if(cone.w>=${wgslF32(HALF_PI)}){return false;}
 if(!conformalOf(w)){return false;}
 let world=worldPose(w);
 let c=0.5*(bmin+bmax);let e=0.5*(bmax-bmin);
 let center=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 let eye=viewPoint();
 let toCam=eye.xyz-center*eye.w;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=invTranspose3Apply(normalOf(w),cone.xyz);
 let al=length(axis);
 if(!(al>0.0)){return false;}
 let axisWorld=axis/al;
 // An axis that does not point away from the camera never rejects: \`d < -sin(angle + spread)\`
 // needs d < 0 for any angle in [0, pi/2). Tested first, the verdict no longer rests on the GPU
 // \`sin\` near zero, whose error could reject a cluster seen edge-on (d = 0) that the CPU mirror
 // (\`boxConeRejects\`, in double precision) keeps; the length, arcsine and sine below are then
 // paid only by clusters that can still be rejected.
 let d=dot(axisWorld,view);
 if(!(d<0.0)){return false;}
 let radius=length(we);
 if(dist<=radius*eye.w){return false;}
 let spread=asin(clamp(radius*eye.w/dist,0.0,1.0));
 return d<-sin(cone.w+spread)&&(cone.w+spread)<${wgslF32(HALF_PI)};
}
fn coneRejects(r:u32,w:u32)->bool{
 // A deformed primitive's normals are not its rest pose's: no cone rejects it.
 if(hasBox(r)==0.0||deformReach>0.0){return false;}
 return coneRejectsBox(coneOf(r),boxMin(r),boxMax(r),w);
}
/** Cone reject depends only on the page, its world and the camera: it is therefore the same for
 *  the passes of one frame. \`dagWanted\` computes it once per live page and stores it behind the
 *  draw flags; \`dagMask\` rereads it instead of redoing \`asin\`, \`sin\` and the two \`length\`s.
 *  It only reads it for a live page, the only one it was written for. */
fn coneCache(index:u32)->u32{return views[0u].queueCap+views[0u].clusterCount+index;}
/** Bits of the cone cache word: the cone verdict, then — camera cut only — the two comparisons of
 *  the cut rule (\`parentPixels > t\`, \`ownPixels <= t\`), made once by \`dagWanted\`. */
const CONE_REJECTED:u32=1u;const PARENT_ABOVE:u32=2u;const OWN_WITHIN:u32=4u;
`,
)
