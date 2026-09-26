/**
 * The arithmetic of the coverage-preserving alpha rule (docs/FORMAT.md, "Coverage-preserving alpha
 * (#44)"; `texture_preview/coverage.rs`), in WGSL for the card's WebGPU chains. The scale: `median`, a level's alpha byte as the compiler rounds it, and `scaled`,
 * step 4. The pick: `pick`, step 3 over the level's histogram, `binOf(t)`, which the including
 * shader declares; its products pass 32 bits, so `wide` holds one as (high, low) words, `apart`
 * their distance, and `below` orders (error, distance to C, t) as the compiler's `min` does.
 */
export const COVERAGE_SCALE_WGSL = `
fn median(a:vec4f)->u32{let b=vec4u(round(a*255.0));return (min(max(b.x,b.y),max(b.z,b.w))+max(min(b.x,b.y),min(b.z,b.w))+1u)>>1u;}
fn scaled(a:u32,c:u32,t:u32)->u32{return min(255u,u32((2u*a*(2u*c-1u)+2u*t-1u)/(4u*t-2u)));}`;
export const COVERAGE_PICK_WGSL = `
fn wide(a:u32,b:u32)->vec2u{
 let al=a&0xffffu;let ah=a>>16u;let bl=b&0xffffu;let bh=b>>16u;
 let mid=((al*bl)>>16u)+((al*bh)&0xffffu)+((ah*bl)&0xffffu);
 return vec2u(ah*bh+((al*bh)>>16u)+((ah*bl)>>16u)+(mid>>16u),(mid<<16u)|((al*bl)&0xffffu));
}
fn below(a:vec4u,b:vec4u)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&(a.z<b.z||(a.z==b.z&&a.w<b.w)))));}
fn apart(a:vec2u,b:vec2u)->vec2u{
 let swap=below(vec4u(a,0u,0u),vec4u(b,0u,0u));let hi=select(a,b,swap);let lo=select(b,a,swap);
 return vec2u(hi.x-lo.x-u32(hi.y<lo.y),hi.y-lo.y);
}
fn pick(c:u32,covered:u32,texels:vec2u)->u32{
 let goal=wide(covered,texels.y);var best=vec4u(0xffffffffu,0xffffffffu,255u,c);var above=0u;
 for(var t=255u;t>0u;t--){
  above+=binOf(t);let error=apart(wide(above,texels.x),goal);
  let next=vec4u(error.x,error.y,max(t,c)-min(t,c),t);
  if(below(next,best)){best=next;}
 }
 return best.w;
}`;
