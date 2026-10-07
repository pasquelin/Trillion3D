// The surface stage's WGSL (`rank.ts` says what it stores), imported with transmission's code
// (`transmissionCode.ts`): the core holds the rank alone.
import { WATER_MAX_ITEMS, WATER_RANK_SHIFT } from './rank.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PHYSICAL_TEXEL_WGSL } from '../../visibility/shader/physicalWgsl.ts'

/** The values of the surface stage, in their targets' order: the surface buffer, then, with
 *  `lobed`, the lobes target. The virtual-texture feedback follows them (`waterSurfaceTargets`). */
export const waterOutFields = (lobed: boolean): [string, string][] => [
  ...['baseMetal', 'normalRough', 'emissiveAo', 'word'].map((name): [string, string] => [
    name,
    'vec4f',
  ]),
  ...(lobed ? [['lobes', 'vec4u'] as [string, string]] : []),
]

/** One entry of the stage: `fsWater`, or with `lobed` `fsWaterLobed`, which reads the item's
 *  record before its material (`blendPhysicalBegin`) and stores the fragment's lobes. */
function waterEntry(lobed: boolean) {
  const name = lobed ? 'WaterLobed' : 'Water',
    fields = [...waterOutFields(lobed), ['request', 'u32']]
  const zero = fields.map(([, type]) =>
    type === 'u32' ? '0u' : `${type}(0${type.endsWith('u') ? 'u' : '.0'})`,
  )
  return `struct ${name}Out{${fields.map(([field, type], at) => `@location(${at}) ${field}:${type},`).join('')}}
@fragment fn fs${name}(in:VSOut,@builtin(front_facing) front:bool)->${name}Out{
 let g=blendGrads(in);let base=blendBase(in,g);
 if(!blendKeeps(in,base,front)){discard;return ${name}Out(${zero});}
 ${lobed ? 'blendPhysicalBegin(in,g);' : ''}
 let s=blendSurface(in,front,g,base);
 return ${name}Out(vec4f(s.rgb,s.metal),vec4f(s.N,s.rough),vec4f(s.emissive,s.ao),waterSurfaceWord(in,s),${lobed ? 'waterLobedTexel(in,front,g,s),' : ''}s.request);
}`
}

/**
 * The surface stage: the four targets of the surface buffer, then the virtual-texture feedback.
 * With `lobes`, the blend module's lobed program holding it, `fsWaterLobed` too, the stage of an
 * image whose transmissive surface carries an anisotropic or clear-coat lobe
 * (`waterLobesWgsl.ts`): the blend's lobes of the fragment (`blendPhysicalValues`) in one more
 * target, the lobes target (`../../scene/physicalLobes.ts`) the opaque resolve's lighting consumed
 * — zero where neither lobe remains —, depth-tested as every other target, so the nearest
 * surface's lobes are the ones kept.
 */
export const waterSurfaceWgsl = (lobes: boolean) =>
  wgslBlock(
    'waterSurfaceWgsl',
    lobes ? [WATER_LOBED_WGSL] : [],
    `
fn waterSurfaceWord(in:VSOut,s:BlendSurface)->vec4f{
 let opacity=u32(round(clamp(s.alpha,0.0,1.0)*65535.0));
 return unpack4x8unorm((in.water&${WATER_MAX_ITEMS}u)|(opacity<<${WATER_RANK_SHIFT}u));
}
${waterEntry(false)}`,
  )

/** The lobed entry and what it stores: the fragment's lobes as the lobes target holds them. */
const WATER_LOBED_WGSL = wgslBlock(
  'WATER_LOBED_WGSL',
  [PHYSICAL_TEXEL_WGSL],
  `
/** The fragment's lobes as the lobes target holds them, zero without either. */
fn waterLobedTexel(in:VSOut,front:bool,g:BlendGrads,s:BlendSurface)->vec4u{
 if(!physicalOn){return vec4u(0u);}
 let v=blendPhysicalValues(in,front,g,s);
 if(physicalLobeless(v)){return vec4u(0u);}
 return physicalTexel(v);
}
${waterEntry(true)}`,
)
/** The composite's reading of that fourth word: rank and opacity, as the stage packed them. */
export const WATER_UNPACK_WGSL = wgslBlock(
  'WATER_UNPACK_WGSL',
  [],
  `
fn waterWordAt(coord:vec2i)->u32{return pack4x8unorm(textureLoad(waterWord,coord,0));}
fn waterRank(packed:u32)->u32{return (packed&${WATER_MAX_ITEMS}u)-1u;}
fn waterOpacity(packed:u32)->f32{return f32(packed>>${WATER_RANK_SHIFT}u)/65535.0;}
`,
)
