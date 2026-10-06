/**
 * THE OCTAHEDRAL CARD READ IN GLSL (#1336): the WebGL2 twin of `IMPOSTOR_CARD_WGSL`
 * (`impostorWgsl.ts`) — the same functions, the same arithmetic in the same order, the same
 * branches (`select(a,b,c)` read as `c?b:a`) — so the WebGL2 card blends the same three frames
 * with the same weights, the same parallax and the same depth offset as the WebGPU one. It samples
 * the three atlas maps the card program declares (`webgl/impostor/cardGlsl.ts`): `impostorColour`,
 * `impostorNormalDepth`, `impostorOrm`, at the mip level `lod` the card's texel footprint asks.
 */
const IMPOSTOR_MATH_GLSL = `
float impSide(float x){return x<0.0?-1.0:1.0;}
vec2 impOctEncode(vec3 d,float hemi){
 vec3 o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 vec2 folded=vec2(impSide(o.x)*(1.0-abs(o.z)),impSide(o.z)*(1.0-abs(o.x)));
 vec2 full=o.y<0.0?folded:o.xz;
 vec3 hd=vec3(d.x,max(d.y,0.0),d.z);
 vec3 ho=hd/(abs(hd.x)+max(hd.y,0.0)+abs(hd.z));
 return hemi==1.0?vec2(ho.x+ho.z,ho.z-ho.x):full;
}
vec3 impOctDecode(vec2 f,float hemi){
 float hx=f.x-f.y;
 float hz=f.x+f.y-1.0;
 vec3 hemiDir=normalize(vec3(hx,1.0-abs(hx)-abs(hz),hz));
 vec2 u=f*2.0-1.0;
 float y=1.0-abs(u.x)-abs(u.y);
 vec3 folded=normalize(vec3(impSide(u.x)*(1.0-abs(u.y)),y,impSide(u.y)*(1.0-abs(u.x))));
 vec3 full=y>=0.0?normalize(vec3(u.x,y,u.y)):folded;
 return hemi==1.0?hemiDir:full;
}
vec3 impWeights(vec2 f){
 return vec3(min(1.0-f.x,1.0-f.y),abs(f.x-f.y),min(f.x,f.y));
}`

/** The card's view, once per card (the vertex stage), as `IMPOSTOR_VIEW_WGSL`. */
const IMPOSTOR_VIEW_GLSL = `
struct ImpView{vec2 a;vec2 b;vec2 c;vec3 w;};
ImpView impView(vec3 eye,float frames,float hemi){
 float last=frames-1.0;
 vec2 g=clamp((impOctEncode(normalize(eye),hemi)*0.5+0.5)*last,vec2(0.0),vec2(last));
 vec2 g0=min(floor(g),vec2(last-1.0));
 vec2 f=g-g0;
 return ImpView(g0,f.x>f.y?g0+vec2(1.0,0.0):g0+vec2(0.0,1.0),g0+vec2(1.0),impWeights(f));
}
vec3 impFrameNormal(vec2 frame,float frames,float hemi){return impOctDecode(frame/(frames-1.0),hemi);}
vec3 impFrameX(vec3 n){
 vec3 up=abs(n.y)>0.999?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0);
 return normalize(cross(up,n));
}`

/** Per pixel: the ray on each frame's plane, one-step parallax and the blend, as
 *  `IMPOSTOR_TAP_WGSL`. */
export const IMPOSTOR_TAP_GLSL = `
struct ImpTap{vec2 uv;vec3 point;};
ImpTap impTap(vec2 frame,vec3 x,vec3 n,vec3 eye,vec3 ray,float radius,float cell,float lod){
 vec3 y=cross(n,x);
 float t=-dot(n,eye)/dot(n,ray);
 vec3 h=eye+t*ray;
 vec2 uv=vec2(dot(x,h),dot(y,h))/(2.0*radius)+0.5;
 vec3 v=-ray;
 float vn=max(dot(n,v),0.001);
 float d=textureLod(impostorNormalDepth,(frame+clamp(uv,vec2(0.0),vec2(1.0)))*cell,lod).w;
 uv+=(d-0.5)*vec2(dot(x,v),dot(y,v))/vn;
 return ImpTap((frame+clamp(uv,vec2(0.0),vec2(1.0)))*cell,h+(d-0.5)*2.0*radius*v/vn);
}
struct ImpBlend{vec4 colour;vec3 normal;vec3 orm;vec3 point;};
ImpBlend impBlend(ImpTap a,ImpTap b,ImpTap c,vec3 w,float lod){
 vec4 colour=w.x*textureLod(impostorColour,a.uv,lod)
            +w.y*textureLod(impostorColour,b.uv,lod)
            +w.z*textureLod(impostorColour,c.uv,lod);
 vec3 packed=w.x*textureLod(impostorNormalDepth,a.uv,lod).xyz
            +w.y*textureLod(impostorNormalDepth,b.uv,lod).xyz
            +w.z*textureLod(impostorNormalDepth,c.uv,lod).xyz;
 vec3 orm=w.x*textureLod(impostorOrm,a.uv,lod).xyz
         +w.y*textureLod(impostorOrm,b.uv,lod).xyz
         +w.z*textureLod(impostorOrm,c.uv,lod).xyz;
 return ImpBlend(colour,normalize(packed*2.0-1.0),orm,w.x*a.point+w.y*b.point+w.z*c.point);
}`

/** The mapping and the card's view: what the card's vertex stage reads; the fragment stage reads
 *  the tap and the blend (`IMPOSTOR_TAP_GLSL`). */
export const IMPOSTOR_VIEW_CARD_GLSL = `${IMPOSTOR_MATH_GLSL}\n${IMPOSTOR_VIEW_GLSL}`
