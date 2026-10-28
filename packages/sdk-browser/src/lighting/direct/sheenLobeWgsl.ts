import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { ndotvClamped } from '../../../../math/src/wgsl/lighting.ts'
import { tangentSide } from '../../../../math/src/wgsl/basis.ts'
import { vectorRejection } from '../../../../math/src/wgsl/geometry.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { sheenLtcCoefficients } from '../sheenLtcWgsl.ts'
import { RECT_LIGHT_WGSL } from './rectLightWgsl.ts'
import { MIN_FUZZ_ROUGHNESS } from './sheenFuzz.ts'

/**
 * THE CLOTH'S FUZZ LOBE, a layer of fibres over the surface, lit through the sheen table the light buffer holds
 * (`../sheenLtcWgsl.ts`): the multiple-scattering sheen as a cosine bent by a linear transform (Zeltner
 * et al., "Practical Multiple-Scattering Sheen Using Linearly Transformed Cosines", 2022). For a view of
 * cosine N·V on a fuzz of roughness r the table gives the transform's two entries `aInv`, `bInv` and the
 * lobe's directional albedo E, the share of the light it sends back. The fuzz sits over the surface's
 * own lobes: its colour times the cloth amount times E is the light it adds, and the diffuse and the
 * specular under it keep one minus the amount times E of theirs (`sheenKeep`). E is the table's at every setting of the
 * shading's energy conservation: that setting changes the layers under the fuzz, never the fuzz's albedo.
 *
 * Everything a view fixes is taken once a pixel (`sheenViewOf`): the table read and the frame of the
 * normal and the view, whose first axis is the view's part across the normal (an axis across the normal
 * where the view is along it, which the table's lobe is round about). A light then costs a few products:
 * a point, a sun or a lamp's centre by `sheenFuzzEval`, a rectangle by `sheenRect`.
 */

/** The fuzz's roughness from the surface's `rough`: half way between the surface's and one, the range the cloth's roughness
 *  is mapped onto for the sheen table, held between `MIN_FUZZ_ROUGHNESS` and 1. */
export const sheenFuzzRoughness = wgslFn(
  'sheenFuzzRoughness',
  [],
  `fn sheenFuzzRoughness(rough:f32)->f32{return clamp(0.5+0.5*rough,${wgslF32(MIN_FUZZ_ROUGHNESS)},1.0);}`,
)

/** What a pixel's view fixes of its fuzz: the frame of the normal and the view (`T1` the view's part across the
 *  normal, unit, `T2` across both) and the table's `aInv`, `bInv` and `albedo`. */
const SHEEN_VIEW_WGSL = wgslStruct(
  'SheenView',
  [],
  'struct SheenView{T1:vec3f,T2:vec3f,aInv:f32,bInv:f32,albedo:f32,}',
)

/** The fuzz of a pixel of normal `N` seen along `V`, of fuzz roughness `fuzzRoughness` (`sheenFuzzRoughness`), read
 *  from the table (`sheenLtcCoefficients`) at the cosine the surface's lobes take (`ndotvClamped`). A view along the normal has no across part: the frame takes any axis across the normal. */
const sheenViewOf = wgslFn(
  'sheenViewOf',
  [SHEEN_VIEW_WGSL, sheenLtcCoefficients, ndotvClamped, vectorRejection, tangentSide],
  `fn sheenViewOf(N:vec3f,V:vec3f,fuzzRoughness:f32)->SheenView{
 let side=vectorRejection(V,N);
 let T1=normalize(select(side,tangentSide(N),dot(side,side)<1e-10));
 let ltc=sheenLtcCoefficients(ndotvClamped(N,V),fuzzRoughness);
 return SheenView(T1,cross(N,T1),ltc.x,ltc.y,ltc.z);
}`,
)

/** The vector `q` (a direction, or a corner relative to the point) moved by the table's transform, in the frame of the normal
 *  and the view (`T1`, `T2`, `N`): `(aInv x + bInv z, aInv y, z)`. The one formula of the point path and the rectangle's. */
const sheenCorner = wgslFn(
  'sheenCorner',
  [SHEEN_VIEW_WGSL],
  `fn sheenCorner(v:SheenView,N:vec3f,q:vec3f)->vec3f{
 let z=dot(N,q);
 return vec3f(v.aInv*dot(v.T1,q)+v.bInv*z,v.aInv*dot(v.T2,q),z);
}`,
)

/**
 * The fuzz lobe of a light in the direction `L` (unit, toward the light; the centre of a lamp), times the
 * cosine of the normal `N` with it, per unit of the light and before the lobe's albedo: the cosine
 * distribution of the direction moved by the transform (`sheenCorner`), `cos'/π`, times the transform's Jacobian,
 * `(aInv/|w|²)²` with `w` the moved direction. Zero at or below the horizon.
 */
const sheenFuzzEval = wgslFn(
  'sheenFuzzEval',
  [SHEEN_VIEW_WGSL, sheenCorner, INVERSE_PI],
  `fn sheenFuzzEval(v:SheenView,N:vec3f,L:vec3f)->f32{
 let w=sheenCorner(v,N,L);
 if(w.z<=0.0){return 0.0;}
 let jacobian=v.aInv/dot(w,w);
 return w.z*INVERSE_PI*jacobian*jacobian;
}`,
)

/** The light a fuzz of colour `fuzz` and cloth amount `amount` adds for a light in the direction `L` of energy
 *  `energy` (its colour, attenuation and shadow, without the cosine): the colour times the amount, the energy, the
 *  lobe (`sheenFuzzEval`) and its albedo. */
const sheenFuzz = wgslFn(
  'sheenFuzz',
  [SHEEN_VIEW_WGSL, sheenFuzzEval],
  `fn sheenFuzz(v:SheenView,N:vec3f,L:vec3f,fuzz:vec3f,amount:f32,energy:f32)->vec3f{
 return fuzz*(amount*energy*v.albedo*sheenFuzzEval(v,N,L));
}`,
)

/** What the diffuse and the specular under a fuzz of cloth amount `amount` keep of their light: one minus the amount
 *  times the fuzz's albedo (the mix of one and one minus the albedo by the amount). */
const sheenKeep = wgslFn(
  'sheenKeep',
  [SHEEN_VIEW_WGSL],
  'fn sheenKeep(v:SheenView,amount:f32)->f32{return 1.0-amount*v.albedo;}',
)

/** The fuzz of a point light: the view's fuzz, its roughness, the lobe, the light it adds and what it leaves the
 *  layers under it. What a program that lights a cloth with a point, a sun or a lamp lists. */
export const SHEEN_LOBE_WGSL = wgslBlock(
  'SHEEN_LOBE_WGSL',
  [sheenFuzzRoughness, sheenViewOf, sheenFuzz, sheenKeep],
  '',
)

/**
 * The fuzz of a rectangle `r` (`RectView`, its corners relative to the point): the rectangle's four corners moved by the table's
 * transform (`sheenCorner`) and integrated as the diffuse light of the engine's rectangle is, under a normal along the frame's
 * axis (`rectIrradianceOf`: its irradiance is π times the sine squared of the half angle the moved rectangle subtends, times the
 * height of its mean direction wrapped about the horizon), over π: the integral of the lobe over the rectangle per unit of its
 * radiance, times the albedo. A small rectangle far away gives its solid angle times what a point light in its direction gives
 * (`sheenFuzzEval` times the albedo), the same light by either path. Per unit of the rectangle's radiance and before its range window
 * (`r.window`), the caller's; the integral already holds the cosine and the distance, so the light's falloff is not applied to it again.
 * The integral is not scaled again: the reference's extra factor of 2π on a rectangle's fuzz, and its second multiplication by the
 * rectangle's base irradiance, give a rectangle what a point light of the same solid angle does not get, so neither is applied.
 */
export const SHEEN_RECT_WGSL = wgslBlock(
  'SHEEN_RECT_WGSL',
  [SHEEN_VIEW_WGSL, sheenCorner, RECT_LIGHT_WGSL, INVERSE_PI],
  `
fn sheenRect(v:SheenView,N:vec3f,r:RectView)->f32{
 let moved=RectView(sheenCorner(v,N,r.a),sheenCorner(v,N,r.b),sheenCorner(v,N,r.c),sheenCorner(v,N,r.d),1.0);
 return v.albedo*INVERSE_PI*rectIrradianceOf(moved,vec3f(0.0,0.0,1.0)).w;
}`,
)

/** `clothSheen`, the view of a cloth's fuzz at a pixel (`setCloth`): the pixel's normal `N`, view `V` and surface roughness `rough`
 *  (`sheenFuzzRoughness`), the table read from the light buffer. What a program that lights a cloth lists, through the lobes'
 *  hooks (`LOBES_LIGHTING_WGSL`). */
export const CLOTH_SHEEN_WGSL = wgslBlock(
  'CLOTH_SHEEN_WGSL',
  [SHEEN_VIEW_WGSL, sheenViewOf, sheenFuzzRoughness],
  `fn clothSheen(N:vec3f,V:vec3f,rough:f32)->SheenView{
 return sheenViewOf(N,V,sheenFuzzRoughness(rough));
}`,
)
