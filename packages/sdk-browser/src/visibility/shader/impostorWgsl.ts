import { SPRITE_WGSL } from './spriteWgsl.ts';
import { IMPOSTOR_PI } from '../../../../sdk-core/src/impostor/switch.ts';

/**
 * The switch in WGSL, f32 mirror of sdk-core `impostorSwitchDepth` (#817, "When to switch"; proof at
 * the formula site). `radius` is R, `triangles` T, `coverage` c, `frameSide` r_f, `focal` the
 * engine's one focal length in pixels. `z_s = max(z_tex, z_tri)`; the card draws when `z >= z_s`.
 */
export const IMPOSTOR_SWITCH_WGSL = `const IMPOSTOR_PI:f32=${IMPOSTOR_PI};
fn impostorSwitchDepth(radius:f32,triangles:f32,coverage:f32,frameSide:f32,focal:f32)->f32{
 let zTex=2.0*radius*focal/frameSide;
 let zTri=radius*focal*sqrt(coverage*IMPOSTOR_PI/triangles);
 return max(zTex,zTri);
}`;

/**
 * The octahedral mapping and the three-frame blend, object space, pivot at the bounding-sphere
 * centre, +Y up: the WGSL mirror of the compiler's `octahedron.rs` (#817), whose tests are the
 * oracle (`visibility/shader/impostorWgsl.test.ts`). `hemi` is 1 for the upper hemi-octahedron.
 * Every function here is a declaration or a single return, so the software shader harness reads
 * the shipped text and not a copy of its formula.
 */
export const IMPOSTOR_MATH_WGSL = `
/** ±1, never 0: the fold of the lower half needs a side even on an axis (\`side\` of \`octahedron.rs\`). */
fn impSide(x:f32)->f32{return select(1.0,-1.0,x<0.0);}
/** Direction \`d\` to the plane [-1,1]²: the full octahedron, or the upper hemi-octahedron. */
fn impOctEncode(d:vec3f,hemi:f32)->vec2f{
 let o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 let folded=vec2f(impSide(o.x)*(1.0-abs(o.z)),impSide(o.z)*(1.0-abs(o.x)));
 let full=select(o.xz,folded,o.y<0.0);
 let hd=vec3f(d.x,max(d.y,0.0),d.z);
 let ho=hd/(abs(hd.x)+max(hd.y,0.0)+abs(hd.z));
 return select(full,vec2f(ho.x+ho.z,ho.z-ho.x),hemi==1.0);
}
/** Grid coordinates \`f\` in [0,1]² back to a unit direction, the inverse of \`impOctEncode\`. */
fn impOctDecode(f:vec2f,hemi:f32)->vec3f{
 let hx=f.x-f.y;
 let hz=f.x+f.y-1.0;
 let hemiDir=normalize(vec3f(hx,1.0-abs(hx)-abs(hz),hz));
 let u=f*2.0-1.0;
 let y=1.0-abs(u.x)-abs(u.y);
 let folded=normalize(vec3f(impSide(u.x)*(1.0-abs(u.y)),y,impSide(u.y)*(1.0-abs(u.x))));
 let full=select(folded,normalize(vec3f(u.x,y,u.y)),y>=0.0);
 return select(full,hemiDir,hemi==1.0);
}
/** The three frame weights at grid position \`f\`: they sum to one on both triangles of a cell. */
fn impWeights(f:vec2f)->vec3f{
 return vec3f(min(1.0-f.x,1.0-f.y),abs(f.x-f.y),min(f.x,f.y));
}`;

/** x, y, n of a frame's capture plane (\`basis\` of \`octahedron.rs\`); the ray on it, one-step parallax. */
const IMPOSTOR_TAP_WGSL = `
/** The card samples three atlas maps and one sampler the pass declares: colour+coverage,
 *  normal+depth, packed ORM. */
fn impBasis(n:vec3f)->mat3x3f{
 let up=select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(n.y)>0.999);
 let x=normalize(cross(up,n));
 return mat3x3f(x,cross(n,x),n);
}
struct ImpTap{uv:vec2f,point:vec3f}
/** The view ray (origin \`eye\`, direction \`ray\`, object space) on frame \`frame\`'s plane: its atlas
 *  uv and the true surface point \`s_k = h + η·v/v_n\` the depth offset writes. */
fn impTap(frame:vec2f,eye:vec3f,ray:vec3f,radius:f32,frames:f32,hemi:f32)->ImpTap{
 let last=frames-1.0;
 let b=impBasis(impOctDecode(frame/last,hemi));
 let t=-dot(b[2],eye)/dot(b[2],ray);
 let h=eye+t*ray;
 var uv=vec2f(dot(b[0],h),dot(b[1],h))/(2.0*radius)+0.5;
 let v=-ray;
 let vn=max(dot(b[2],v),0.001);
 let cell=1.0/frames;
 let d=textureSampleLevel(impostorNormalDepth,impostorSampler,(frame+clamp(uv,vec2f(0.0),vec2f(1.0)))*cell,0.0).w;
 uv+=(d-0.5)*vec2f(dot(b[0],v),dot(b[1],v))/vn;
 return ImpTap((frame+clamp(uv,vec2f(0.0),vec2f(1.0)))*cell,h+(d-0.5)*2.0*radius*v/vn);
}
struct ImpBlend{colour:vec4f,normal:vec3f,point:vec3f}
/** The blended card at \`pivotToEye\` (object space): colour, normal and the surface point, whose
 *  view-projection is the fragment depth so other objects intersect the card where the mesh would. */
fn impBlend(eye:vec3f,ray:vec3f,pivotToEye:vec3f,radius:f32,frames:f32,hemi:f32)->ImpBlend{
 let last=frames-1.0;
 let g=clamp((impOctEncode(normalize(pivotToEye),hemi)*0.5+0.5)*last,vec2f(0.0),vec2f(last));
 let g0=min(floor(g),vec2f(last-1.0));
 let f=g-g0;
 let w=impWeights(f);
 let middle=select(g0+vec2f(0.0,1.0),g0+vec2f(1.0,0.0),f.x>f.y);
 let a=impTap(g0,eye,ray,radius,frames,hemi);
 let b=impTap(middle,eye,ray,radius,frames,hemi);
 let c=impTap(g0+vec2f(1.0),eye,ray,radius,frames,hemi);
 let colour=w.x*textureSampleLevel(impostorColour,impostorSampler,a.uv,0.0)
           +w.y*textureSampleLevel(impostorColour,impostorSampler,b.uv,0.0)
           +w.z*textureSampleLevel(impostorColour,impostorSampler,c.uv,0.0);
 let packed=w.x*textureSampleLevel(impostorNormalDepth,impostorSampler,a.uv,0.0).xyz
           +w.y*textureSampleLevel(impostorNormalDepth,impostorSampler,b.uv,0.0).xyz
           +w.z*textureSampleLevel(impostorNormalDepth,impostorSampler,c.uv,0.0).xyz;
 return ImpBlend(colour,normalize(packed*2.0-1.0),w.x*a.point+w.y*b.point+w.z*c.point);
}`;

/** The whole card text: the shared sprite basis, the switch, the octahedral blend and the tap. */
export const IMPOSTOR_CARD_WGSL = `${SPRITE_WGSL}\n${IMPOSTOR_SWITCH_WGSL}\n${IMPOSTOR_MATH_WGSL}\n${IMPOSTOR_TAP_WGSL}`;
