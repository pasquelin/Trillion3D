import { wgslFn } from './decl.ts'

/**
 * The octahedral map: a unit vector projected on `|x|+|y|+|z| = 1`, its lower half folded over the
 * upper one, lands in the square [-1,1]². Three forms the shaders write, each its own rounding:
 * the signed map, `z` its pole (`octEncode`, `octDecode`); the impostor's, `y` its pole, full or
 * upper hemi-octahedron (`octEncodeHemi`, `octDecodeHemi`); and the packed normal's decode, its
 * fold written per axis without the `max(−z, 0)` step (`octDecodeScalar`).
 */

export const octEncode = wgslFn(
  'octEncode',
  [],
  `fn octEncode(n:vec3f)->vec2f{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 return select((1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)),p,n.z>=0.0);
}`,
)

export const octDecode = wgslFn(
  'octDecode',
  [],
  `fn octDecode(e:vec2f)->vec3f{
 var n=vec3f(e,1.0-abs(e.x)-abs(e.y));
 let t=max(-n.z,0.0);
 n=vec3f(n.xy+select(vec2f(t),vec2f(-t),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}`,
)

// sdk-browser/src/visibility/shader/impostorWgsl.ts (`impSide`): ±1, never 0, called by
// `octDecodeHemi` alone
const octSide = wgslFn('octSide', [], 'fn octSide(x:f32)->f32{return select(1.0,-1.0,x<0.0);}')

// sdk-browser/src/visibility/shader/impostorWgsl.ts (`impOctEncode`)
export const octEncodeHemi = wgslFn(
  'octEncodeHemi',
  [],
  `fn octEncodeHemi(d:vec3f,hemi:f32)->vec2f{
 let o=d/(abs(d.x)+abs(d.y)+abs(d.z));
 let q=o.xz;
 let full=select(q,(1.0-abs(q.yx))*select(vec2f(-1.0),vec2f(1.0),q>=vec2f(0.0)),o.y<0.0);
 let hd=vec3f(d.x,max(d.y,0.0),d.z);
 let ho=hd/(abs(hd.x)+max(hd.y,0.0)+abs(hd.z));
 return select(full,vec2f(ho.x+ho.z,ho.z-ho.x),hemi==1.0);
}`,
)

// sdk-browser/src/visibility/shader/impostorWgsl.ts (`impOctDecode`)
export const octDecodeHemi = wgslFn(
  'octDecodeHemi',
  [octSide],
  `fn octDecodeHemi(f:vec2f,hemi:f32)->vec3f{
 let hx=f.x-f.y;
 let hz=f.x+f.y-1.0;
 let hemiDir=normalize(vec3f(hx,1.0-abs(hx)-abs(hz),hz));
 let u=f*2.0-1.0;
 let y=1.0-abs(u.x)-abs(u.y);
 let folded=normalize(vec3f(octSide(u.x)*(1.0-abs(u.y)),y,octSide(u.y)*(1.0-abs(u.x))));
 let full=select(folded,normalize(vec3f(u.x,y,u.y)),y>=0.0);
 return select(full,hemiDir,hemi==1.0);
}`,
)

// sdk-browser/src/cluster/decodeWgsl.ts (`clusterNormal`, past its byte unpacking)
export const octDecodeScalar = wgslFn(
  'octDecodeScalar',
  [],
  `fn octDecodeScalar(e:vec2f)->vec3f{
 var x=e.x;var y=e.y;
 let z=1.0-abs(x)-abs(y);
 if(z<0.0){
  let fx=(1.0-abs(y))*select(-1.0,1.0,x>=0.0);let fy=(1.0-abs(x))*select(-1.0,1.0,y>=0.0);
  x=fx;y=fy;
 }
 return normalize(vec3f(x,y,z));
}`,
)
