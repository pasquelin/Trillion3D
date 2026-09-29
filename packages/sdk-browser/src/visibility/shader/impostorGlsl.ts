import { SPRITE_GLSL } from './spriteWgsl.ts';

/** The WebGL2 twin of `impostorWgsl.ts` (one atlas, one switch, one card): same arithmetic, same
 *  order, and the shared sprite basis (`spriteAt` of `spriteWgsl.ts`) for the camera-facing quad. */
export const IMPOSTOR_SWITCH_GLSL = `const float IMPOSTOR_PI=3.141592653589793;
float impostorSwitchDepth(float radius,float triangles,float coverage,float frameSide,float focal){
 float zTex=2.0*radius*focal/frameSide;
 float zTri=radius*focal*sqrt(coverage*IMPOSTOR_PI/triangles);
 return max(zTex,zTri);
}`;

/** The octahedral mapping and the three-frame weights, GLSL, the mirror of `IMPOSTOR_MATH_WGSL`. */
export const IMPOSTOR_MATH_GLSL = `
float impSide(float x){return x<0.0?-1.0:1.0;}
vec2 impOctEncode(vec3 d,float hemi){
 vec3 o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 vec2 folded=vec2(impSide(o.x)*(1.0-abs(o.z)),impSide(o.z)*(1.0-abs(o.x)));
 vec2 full=o.y<0.0?folded:o.xz;
 vec3 hd=vec3(d.x,max(d.y,0.001),d.z);
 vec3 ho=hd/(abs(hd.x)+max(hd.y,0.001)+abs(hd.z));
 return hemi==1.0?vec2(ho.x+ho.z,ho.z-ho.x):full;
}
vec3 impOctDecode(vec2 f,float hemi){
 float hx=f.x-f.y;
 float hz=f.x+f.y-1.0;
 vec3 hemiDir=normalize(vec3(hx,1.0-abs(hx)-abs(hz),hz));
 vec2 u=f*2.0-1.0;
 float y=1.0-abs(u.x)-abs(u.y);
 vec3 folded=vec3(impSide(u.x)*(1.0-abs(u.y)),y,impSide(u.y)*(1.0-abs(u.x)));
 vec3 full=y>=0.0?normalize(vec3(u.x,y,u.y)):folded;
 return hemi==1.0?hemiDir:full;
}
vec3 impWeights(vec2 f){
 return vec3(min(1.0-f.x,1.0-f.y),abs(f.x-f.y),min(f.x,f.y));
}`;

/** The tap and the blend, GLSL, sampling the three atlas maps the program declares. */
export const IMPOSTOR_TAP_GLSL = `
mat3 impBasis(vec3 n){
 vec3 up=abs(n.y)>0.999?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0);
 vec3 x=normalize(cross(up,n));
 return mat3(x,cross(n,x),n);
}
struct ImpTap{vec4 colour;vec3 normal;vec3 point;};
ImpTap impTap(vec3 eye,vec3 ray,vec2 frame,float radius,float frames,float hemi){
 float last=frames-1.0;
 mat3 b=impBasis(impOctDecode(frame/last,hemi));
 float t=-dot(b[2],eye)/dot(b[2],ray);
 vec3 h=eye+t*ray;
 vec2 uv=vec2(dot(b[0],h),dot(b[1],h))/(2.0*radius)+0.5;
 vec3 v=-ray;
 float vn=max(dot(b[2],v),0.001);
 float cell=1.0/frames;
 float d=textureLod(impostorNormalDepth,(frame+clamp(uv,vec2(0.0),vec2(1.0)))*cell,0.0).w;
 uv+=(d-0.5)*vec2(dot(b[0],v),dot(b[1],v))/vn;
 vec2 at=(frame+clamp(uv,vec2(0.0),vec2(1.0)))*cell;
 ImpTap outTap;
 outTap.colour=textureLod(impostorColour,at,0.0);
 outTap.normal=textureLod(impostorNormalDepth,at,0.0).xyz*2.0-1.0;
 outTap.point=h+(d-0.5)*2.0*radius*v/vn;
 return outTap;
}
void impBlend(vec3 eye,vec3 ray,vec3 pivotToEye,float radius,float frames,float hemi,
 out vec4 colour,out vec3 normal,out vec3 point){
 float last=frames-1.0;
 vec2 g=clamp((impOctEncode(normalize(pivotToEye),hemi)*0.5+0.5)*last,vec2(0.0),vec2(last));
 vec2 g0=min(floor(g),vec2(last-1.0));
 vec2 f=g-g0;
 vec3 w=impWeights(f);
 vec2 middle=f.x>f.y?g0+vec2(1.0,0.0):g0+vec2(0.0,1.0);
 ImpTap a=impTap(eye,ray,g0,radius,frames,hemi);
 ImpTap b=impTap(eye,ray,middle,radius,frames,hemi);
 ImpTap c=impTap(eye,ray,g0+vec2(1.0),radius,frames,hemi);
 colour=w.x*a.colour+w.y*b.colour+w.z*c.colour;
 normal=normalize(w.x*a.normal+w.y*b.normal+w.z*c.normal);
 point=w.x*a.point+w.y*b.point+w.z*c.point;
}`;

/** The whole GLSL card: the shared sprite basis, the switch, the blend and the tap. */
export const IMPOSTOR_CARD_GLSL = `${SPRITE_GLSL}\n${IMPOSTOR_SWITCH_GLSL}\n${IMPOSTOR_MATH_GLSL}\n${IMPOSTOR_TAP_GLSL}`;
