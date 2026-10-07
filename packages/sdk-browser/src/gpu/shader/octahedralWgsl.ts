/**
 * The signed octahedral map, written once: a unit vector projected on the octahedron
 * `|x|+|y|+|z| = 1`, its lower half folded over the upper one, lands in the square [-1,1]². What
 * the opaque resolve stores of the anisotropy direction and the coat normal (`physicalLobes.ts`),
 * of the shadow receiver's plane (`receiverTargetWgsl.ts`), and how an impostor card finds its
 * frames (`impostorWgsl.ts`) all go through it; each caller only names its functions and packs the
 * square its own way. The functions are generated under the caller's names, so two of them in one
 * shader never declare the same function twice.
 */

/** The fold of a point `p` of the square (a `vec2f` expression) for the lower half: each axis
 *  `1 - |other axis|`, with its own sign, zero counting as positive. */
export const octFoldWgsl = (p: string) =>
  `(1.0-abs(${p}.yx))*select(vec2f(-1.0),vec2f(1.0),${p}>=vec2f(0.0))`

/** `fn name(n:vec3f)->vec2f`: a vector, `z` its pole, to the square; any length but zero. */
export const octEncodeWgsl = (name: string) => `fn ${name}(n:vec3f)->vec2f{
 let p=n.xy/(abs(n.x)+abs(n.y)+abs(n.z));
 return select(${octFoldWgsl('p')},p,n.z>=0.0);
}`

/** `fn name(e:vec2f)->vec3f`: a point of the square back to its unit vector, the fold undone. */
export const octDecodeWgsl = (name: string) => `fn ${name}(e:vec2f)->vec3f{
 var n=vec3f(e,1.0-abs(e.x)-abs(e.y));
 let t=max(-n.z,0.0);
 n=vec3f(n.xy+select(vec2f(t),vec2f(-t),n.xy>=vec2f(0.0)),n.z);
 return normalize(n);
}`
