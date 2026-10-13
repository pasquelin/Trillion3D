import { fieldLayout } from '../gpu/core/fieldLayout.ts'

/**
 * A page-table row (`PageInfo`) in one table: the WGSL struct the shaders read
 * (`shader/pageWgsl.ts`, `PAGE_INFO_STRUCT_WGSL`), each field's first word, which the row writer
 * and every row reader index (`PAGE_INFO.at`), and the row's words. Former atlas padding carries
 * physical transmission and subsurface data; the final aligned block holds deformation metadata
 * without aliasing those material values.
 */
export const PAGE_INFO = fieldLayout('PageInfo', [
  ['world', 'mat4x4f'],
  ['baseColor', 'vec4f'],
  ['metalness', 'f32'],
  ['roughness', 'f32'],
  // The colour map's atlas slot and the material flags: what the shadow pass reads to cut a masked
  // material, and so what a colour tile's arrival is matched against.
  ['mapIndex', 'u32'],
  ['flags', 'u32'],
  // The page's place in the geometry pool, in words: what a slot move writes again, the occupant
  // kept (`../webgpu/row/writers.ts`, `replace`).
  ['pageOffset', 'u32'],
  // How many indices the page draws: what the GPU reads to draw it, and so the only vertex count
  // an image walk needs to reread.
  ['indexCount', 'u32'],
  // The geometry's first vertex in the shared pools, and the row's identifier base
  // (`packedRowBase`, `../webgpu/row/pageRow.ts`).
  ['vertexBase', 'u32'],
  ['packedBase', 'u32'],
  // A dashed line's dash and gap (`lineDash`); zero on any other row.
  ['dash', 'vec2f'],
  ['clusterHash', 'u32'],
  ['hizSlot', 'u32'],
  ['roughnessIndex', 'u32'],
  ['metalnessIndex', 'u32'],
  ['normalIndex', 'u32'],
  ['normalScale', 'f32'],
  // A sprite's turn and size rule (`spriteAt`); zero on any other row.
  ['sprite', 'vec2f'],
  // Declared volume transmission, read before replacing a caster row.
  ['transmission', 'f32'],
  ['thickness', 'f32'],
  ['attenuationRG', 'vec2f'],
  ['aoIndex', 'u32'],
  ['aoIntensity', 'f32'],
  ['attenuationB', 'f32'],
  ['attenuationDistance', 'f32'],
  ['emissiveIndex', 'u32'],
  ['selectionIndex', 'u32'],
  ['emissive', 'vec4f'],
  ['subsurfaceRG', 'vec2f'],
  ['normalScaleY', 'f32'],
  // One on a coarse row (`PageRec.role`), which the level-of-detail view reads.
  ['pad1', 'f32'],
  ['screenError', 'f32'],
  // The surface's opacity, its colour factor's alpha: the light a blended caster stops, and what
  // a cutout multiplies its alpha by (`maskKeep`).
  ['blendCoverage', 'f32'],
  ['subsurfaceB', 'f32'],
  ['subsurfaceMap', 'u32'],
  ['depthBias', 'u32'],
  // The width a line page's quads widen to; zero for triangles.
  ['lineWidth', 'f32'],
  // The line's placement, and the resolve class key (`shader/materialClass.ts`).
  ['placement', 'u32'],
  ['materialClass', 'u32'],
  // `deform` is the float-pool record address plus one, zero without deformation; `deformOutput`
  // carries the `DEFORM_*` bits (`types.ts`).
  ['deform', 'u32'],
  ['deformCount', 'u32'],
  ['deformOutput', 'u32'],
  // The surface's physical record rank plus one, zero without an anisotropic or clear-coat lobe
  // (`../webgpu/visibility/physicalTable.ts`).
  ['physical', 'u32'],
] as const)
