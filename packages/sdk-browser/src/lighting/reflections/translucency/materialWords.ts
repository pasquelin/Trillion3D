import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'

/** The words a placement's material takes in the scene trace's table (`sceneTraceResources.ts`): nineteen words, read by a hit through its placement. */
export const TRACED_MATERIAL_WORDS = 19

/** The words of a material by name: the diffuse colour (3), the opacity, the emitted light (3), the roughness, the share of the light the medium lets through (3), the index of refraction, the specular colour (3), the flags and the cutout (the threshold, the base map's atlas slot or, for a graph's mask, the rank of the surface's record, and the bits of `TRACED_MASK_FLAGS`). */
export const TRACED_MATERIAL_AT = {
  diffuse: 0,
  opacity: 3,
  emissive: 4,
  roughness: 7,
  through: 8,
  ior: 11,
  specular: 12,
  flags: 15,
  cut: 16,
  map: 17,
  mask: 18,
} as const

/** The flags of a material: it is worn (a placement without a surface is opaque grey), it is translucent (blended or transmissive). */
export const TRACED_MATERIAL_FLAGS = { worn: 1, translucent: 2 } as const

/** The bits of a cutout's word: the surface is cut by its base map's alpha or its opacity (`masked`), reads a base map (`mapped`), reads it by the filter its slot takes (`sampled`), multiplies the alpha by the vertex colour's (`coloured`) and is cut by the `opacityMask` of its material graph (`graph`: the map word is then the rank of its record in the material table, and no base map is read). */
export const TRACED_MASK_FLAGS = {
  masked: 1,
  mapped: 2,
  sampled: 4,
  coloured: 8,
  graph: 32,
} as const

/** Where the texture set the cutout reads (0 to 7, as the row's three `FLAG_MAP_UV_*` say) lies in a cutout's word, in three bits: a set past the first is read from the cutout coordinates of the corners
 *  where the primitive's record names the same set (`RAY_TRACING_FLAG_MASK_SET`), else at the first. */
export const TRACED_MASK_SET_SHIFT = 6

/** What the cutout of a placement's surface is made of: the threshold, the slot of the base map in the colour atlas (zero for none; for a surface cut by its graph, the rank of its record in the material table) and the bits of `TRACED_MASK_FLAGS`; none for a surface that is not cut. */
export interface TracedMask {
  readonly cut: number
  readonly map: number
  readonly flags: number
}

/** What the words take of a surface a placement wears. */
export interface TracedSurface {
  readonly baseColor: readonly number[]
  readonly metalness: number
  readonly roughness: number
  readonly emissive: readonly number[]
  readonly opacity: number
  readonly transparent?: boolean
  readonly transmission?: number
  readonly ior?: number
  readonly attenuationColor?: readonly number[]
}

/** The dielectric reflectance at normal incidence (the specular colour of a non-metal). */
const DIELECTRIC_F0 = 0.04

const clamp01 = (v: number) => clamp(v, 0, 1)

/**
 * THE MATERIAL WORDS OF A SURFACE, written into `out` at `at` (`TRACED_MATERIAL_WORDS` floats): the diffuse colour (the base colour less its metalness), the specular colour (the dielectric
 * reflectance mixed to the base colour by the metalness), the roughness, the emitted light, the opacity (the coverage of a blended surface; one for an opaque one), and, for a transmissive one,
 * the index of refraction and the colour its medium lets through (its attenuation colour times its transmission) — a blended surface lets through what its coverage leaves. A surface the
 * material graph shades by texture is read at its constants: the hit lighting reads the textures where it lights a hit.
 */
export function writeTracedMaterial(
  out: Float32Array<ArrayBuffer>,
  at: number,
  surface: TracedSurface | undefined,
  mask?: TracedMask,
) {
  out.fill(0, at, at + TRACED_MATERIAL_WORDS)
  const A = TRACED_MATERIAL_AT
  if (!surface) {
    out.fill(0.5, at + A.diffuse, at + A.diffuse + 3)
    out.fill(DIELECTRIC_F0, at + A.specular, at + A.specular + 3)
    out[at + A.opacity] = 1
    out[at + A.roughness] = 1
    out[at + A.ior] = 1
    return
  }
  const metal = clamp01(surface.metalness)
  const transmission = clamp01(surface.transmission ?? 0)
  const tint = surface.attenuationColor ?? [1, 1, 1]
  for (let c = 0; c < 3; c++) {
    const base = surface.baseColor[c]!
    out[at + A.diffuse + c] = base * (1 - metal)
    out[at + A.specular + c] = DIELECTRIC_F0 * (1 - metal) + base * metal
    out[at + A.emissive + c] = surface.emissive[c]!
    out[at + A.through + c] = transmission * tint[c]!
  }
  out[at + A.opacity] = clamp01(surface.opacity)
  out[at + A.roughness] = clamp01(surface.roughness)
  out[at + A.ior] = transmission > 0 ? Math.max(surface.ior ?? 1.5, 1) : 1
  const translucent = !!surface.transparent || transmission > 0
  new Uint32Array(out.buffer, out.byteOffset, out.length)[at + A.flags] =
    TRACED_MATERIAL_FLAGS.worn | (translucent ? TRACED_MATERIAL_FLAGS.translucent : 0)
  if (mask) {
    out[at + A.cut] = mask.cut
    new Uint32Array(out.buffer, out.byteOffset, out.length).set([mask.map, mask.flags], at + A.map)
  }
}

/** The material words of every root, in the order of the cut's roots, the cutout of each (`maskOf`) beside. */
export function tracedMaterialsOf<
  Root extends { readonly worn?: { readonly surface: TracedSurface } },
>(
  roots: readonly Root[],
  out: Float32Array<ArrayBuffer> = new Float32Array(
    Math.max(roots.length, 1) * TRACED_MATERIAL_WORDS,
  ),
  maskOf?: (root: Root) => TracedMask | undefined,
) {
  roots.forEach((root, rank) =>
    writeTracedMaterial(out, rank * TRACED_MATERIAL_WORDS, root.worn?.surface, maskOf?.(root)),
  )
  return out
}

/**
 * A HIT'S MATERIAL (`rttMaterialOf`): the words of the surface a hit met, found by the one resolver (`stMaterialWordOf`, `materialWord.ts`: the placement's, or an HLOD actor's own) and read as the path reads them
 * (`RttMaterial`, `pathWgsl.ts`); an actor's record that names no material reads as an opaque black surface. A surface's blend mode is translucent where it is blended or transmissive; the rest of the scene is opaque. The text lists the scene trace's
 * declarations (`stTable`) and the structure of the path, which the program that lists it also lists, as it lists the resolver.
 */
export const TRACED_MATERIAL_WGSL = wgslBlock(
  'TRACED_MATERIAL_WGSL',
  [],
  `${wgslConsts({ RTT_FLAG_TRANSLUCENT: TRACED_MATERIAL_FLAGS.translucent })}
fn rttMaterialOf(placement:u32,record:u32)->RttMaterial{
 let at=stMaterialWordOf(placement,record);
 var m:RttMaterial;
 if(at==NO_INDEX){
  m.opacity=1.0;
  m.ior=1.0;
  return m;
 }
 m.diffuse=stVec3(at+${TRACED_MATERIAL_AT.diffuse}u);
 m.opacity=bitcast<f32>(stTable[at+${TRACED_MATERIAL_AT.opacity}u]);
 m.emissive=stVec3(at+${TRACED_MATERIAL_AT.emissive}u);
 m.roughness=bitcast<f32>(stTable[at+${TRACED_MATERIAL_AT.roughness}u]);
 m.through=stVec3(at+${TRACED_MATERIAL_AT.through}u);
 m.ior=bitcast<f32>(stTable[at+${TRACED_MATERIAL_AT.ior}u]);
 m.specular=stVec3(at+${TRACED_MATERIAL_AT.specular}u);
 m.blend=select(0u,1u,(stTable[at+${TRACED_MATERIAL_AT.flags}u]&RTT_FLAG_TRANSLUCENT)!=0u);
 m.holdout=false;
 return m;
}`,
)
