/**
 * The light cut's page test, in WGSL: GPU mirror of `boxMissesLightPages`
 * (`packages/sdk-core/src/scene/light-shadow/pageOverlap.ts`), same bounds, same order.
 *
 * `views[0u].viewFlags` says what kind of view the cut serves. A camera sends zero and none of this
 * runs: its text and its verdicts are those of before the light cut.
 * - `VIEW_LIGHT`: every face of a caster writes depth, so the normal cone rejects nothing.
 * - `VIEW_PAGES`: a box reaches the cut only if it covers a page `views[vi].pageMask` marks.
 */
export const VIEW_LIGHT = 2,
  VIEW_PAGES = 4;

export const DAG_PAGES_WGSL = `const VIEW_LIGHT:u32=${VIEW_LIGHT}u;
const VIEW_PAGES:u32=${VIEW_PAGES}u;
fn rowBits(row:u32)->u32{return (views[vi].pageMask[row>>2u]>>((row&3u)*8u))&0xffu;}
fn pageMissed(w:u32,bmin:vec3f,bmax:vec3f)->bool{
 if((views[0u].viewFlags&VIEW_PAGES)==0u){return false;}
 let e=views[vi].view*worlds[w];
 let c=0.5*(bmin+bmax);let h=0.5*(bmax-bmin);
 let v=(e*vec4f(c,1.0)).xyz;
 let ext=abs(e[0].xyz)*h.x+abs(e[1].xyz)*h.y+abs(e[2].xyz)*h.z;
 let p=views[vi].perspective;let flat=1.0-p;
 let near=p*(-v.z-ext.z)+flat;let far=p*(-v.z+ext.z)+flat;
 if(!(near>0.0)){return false;}
 let s=views[vi].clipScale;let pad=views[vi].clipPad;
 let u0=min((v.x-ext.x)*s/near,(v.x-ext.x)*s/far)-pad;let u1=max((v.x+ext.x)*s/near,(v.x+ext.x)*s/far)+pad;
 let v0=min((v.y-ext.y)*s/near,(v.y-ext.y)*s/far)-pad;let v1=max((v.y+ext.y)*s/near,(v.y+ext.y)*s/far)+pad;
 let halfRows=f32(views[vi].pageRows)*0.5;let lastRow=i32(views[vi].pageRows)-1;
 let c0=max(0,i32(floor((u0+1.0)*halfRows)));let c1=min(lastRow,i32(floor((u1+1.0)*halfRows)));
 let r0=max(0,i32(floor((1.0-v1)*halfRows)));let r1=min(lastRow,i32(floor((1.0-v0)*halfRows)));
 if(!(c0<=c1&&r0<=r1)){return true;}
 let span=(((1u<<u32(c1-c0+1))-1u)<<u32(c0))&0xffu;
 for(var row=r0;row<=r1;row++){if((rowBits(u32(row))&span)!=0u){return false;}}
 return true;
}
`;
