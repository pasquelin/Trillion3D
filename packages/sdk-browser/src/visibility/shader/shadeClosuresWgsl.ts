import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { operandKey } from '../../materials/graph/program.ts'
import {
  carriesWeight,
  type WeightTerm,
} from '../../../../sdk-core/src/world/material/graph/closureFlatten.ts'
import {
  CLOSURE_OUTPUTS,
  type ClosureOutput,
} from '../../../../sdk-core/src/world/material/graph/closures.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import { blendFieldOf } from '../../materials/graph/closureBlend.ts'
import {
  graphLobes,
  heldOutputs,
  outputCall,
  type OutputCall,
} from '../../materials/graph/outputsOf.ts'
import {
  GRAPH_SHADING_MODELS,
  type GraphOutput,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { SPECULAR_FLAG_MASK, specularFlag } from '../../materials/surface/surfaceSpecular.ts'
import { FLAG_LIT } from '../types.ts'
import { PHYSICAL_MAP_FIELDS } from '../materialType.ts'
import { PHYSICAL_RESOLVE_WGSL, PHYSICAL_TEXEL_WGSL } from './physicalWgsl.ts'
import { fallbackOf } from '../../materials/graph/program.ts'
import {
  COVERAGE_MAX,
  COVERAGE_PRESENT,
  LUMINANCE_MAX,
  LUMINANCE_SHIFT,
  SURFACE_CLOSURES,
  SURFACE_CLOSURE_OFFSET_BITS,
  closureCoverageLayer,
  closureFlagsLayerOf,
  closureOffsetsLayerOf,
} from '../../materials/surface/surfaceOutputs.ts'
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { closureOffsetsOf } from '../../materials/surface/closureOffsets.ts'
import { SHADE_OUTPUTS_WGSL } from './shadeOutputsWgsl.ts'

/** The code of a term's factor at the pixel. */
function termCode(term: WeightTerm, g: CompiledGraph) {
  const { value } = term
  const op =
    typeof value === 'number'
      ? wgslF32(value)
      : `${g.closures!.operands.get(operandKey(value))}(mgPixel,mgGiven)`
  return term.kind === 'unmix' ? `(1.0-saturate(${op}))` : `saturate(${op})`
}

/** The coverage of closure `k`: its terms from the root, each held to zero to one, times what the blended subtree it is brings (`blend`, the local that holds it). */
function coverageOf(g: CompiledGraph, k: number, blend?: string) {
  const factors = g.closures!.flat.closures[k].terms.map((t) => termCode(t, g))
  if (blend) factors.push(`saturate(${blend}.cov)`)
  return factors.length ? factors.join('*') : '1.0'
}

/**
 * What the vertical layerings that closure `k` is the base of let through of it, as a factor (none where it is the base of none): the
 * reference attenuates the base's luminance weight by what its top leaves uncovered plus what the top lets through,
 * and a slab carries no medium, so the throughput of a top is zero (an opaque slab) and the factor is one minus the
 * top's coverage, a product over the layerings (the outermost first). A top's coverage is the sum of its closures' coverages inside the layering
 * (their terms past the ones from the root to it, times a blended closure's own): exact for a top that is a slab, a mix or an add.
 */
function layerFactor(g: CompiledGraph, k: number) {
  const flat = g.closures!.flat.closures
  const inside = (t: number, outside: number) => {
    const factors = flat[t].terms.slice(outside).map((term) => termCode(term, g))
    if (flat[t].members.length > 1)
      factors.push(
        `saturate(${t === 0 ? 'mgBlend0' : `${g.closures!.blends.get(flat[t].root)}(mgPixel,mgGiven)`}.cov)`,
      )
    return factors.length ? factors.join('*') : '1.0'
  }
  const layers = flat[k].layers.map(
    (layer) => `(1.0-saturate(${layer.tops.map((t) => inside(t, layer.outside)).join('+')}))`,
  )
  return layers.length ? layers.join('*') : undefined
}

/** The functions of the slab closure `k` of `g` takes its attributes from: its first member's. */
const slabOf = (g: CompiledGraph, k: number) =>
  g.closures!.slabs.get(g.closures!.flat.closures[k].members[0].slab)!

/** Which outputs closure `k` of `g` wires: its slab's. */
const wiredBy = (g: CompiledGraph, k: number) => (name: GraphOutput) =>
  !!slabOf(g, k)[name as ClosureOutput]

/** The call of each output of closure `k` of `g` past the first, or of the first where it is blended: its slab's functions, or for a closure
 *  blended from several slabs the fields of the blend `blend` has computed, the closure's other outputs those of its first slab, the
 *  graph's own outputs (the model, the opacity) the graph's. */
function closureCall(g: CompiledGraph, k: number, blend?: string): OutputCall {
  const first = slabOf(g, k)
  const graphCall = outputCall(g, 'mgPixel,mgGiven')
  return (name) => {
    const field = blend ? blendFieldOf(name) : undefined
    if (field) return `${blend}.${field}`
    if (!(CLOSURE_OUTPUTS as readonly string[]).includes(name)) return graphCall(name)
    const fn = first[name as ClosureOutput]
    return fn ? `${fn}(mgPixel,mgGiven)` : fallbackOf(name).code
  }
}

/**
 * The model and the lobes closure `k` (past the first) keeps of its own, as the reference evaluates each of a pixel's BSDFs with its own parameters (its
 * deferred BSDF loop, one BSDF a closure, and its material reads, which take the anisotropy, the roughness and the normal per closure index): its specular, in the bits of the surface flags the first closure's specular takes, and the lobes of its slab (anisotropy,
 * coat, cloth), computed as the first closure's are (`graphLobes`, `physicalValues`) at the closure's own normal and left as one texel of the lobes target
 * and the mark of the lobe in the flags. The shading model and what it needs beyond the surface (`mgModel`) are the graph's, the pixel's. `wired` says which
 * outputs the closure's slab has; `sink` is where the flags and the lobes go (the resolve's stores, the path tracer's hit record).
 */
function closureLobes(
  g: CompiledGraph,
  k: number,
  call: OutputCall,
  held: ReturnType<typeof heldOutputs>,
  wired: (name: GraphOutput) => boolean,
  sink: { flags: string; store: (lobes: string) => string },
) {
  const model = !!g.functions.shadingModel
  const lobes = graphLobes(
    g,
    call,
    model
      ? {
          coat: `mgModel==${GRAPH_SHADING_MODELS.clearCoat}`,
          cloth: `mgModel==${GRAPH_SHADING_MODELS.cloth}`,
        }
      : {},
    wired,
  )
  // The first closure's specular, as its hook leaves it (`shadeGraphWgsl.ts`): an eye with a normal of its own keeps its caustic in those bits, which the closures share.
  const { flags } = sink
  const given = wired('specular') ? `${flags}|=specularFlag(${held.specular});` : ''
  const specular = model
    ? `if(mgModel==${PIXEL_MODEL.eye}&&uni.irisNormal!=0u){${flags}|=flag&${SPECULAR_FLAG_MASK}u;}${given ? `else{${given}}` : ''}`
    : given
  const lobed = lobes
    ? `   if(HAS_PHYSICAL&&physicalOn){
    ${lobes.prelude}
    physicalRecord.lobes=${lobes.lobes};
    physicalRecord.maps=array<u32,${PHYSICAL_MAP_FIELDS.length}>();
    physicalRecord.sheen=${lobes.sheen};
    physicalRecord.law=${lobes.law};
    physicalTangent=${lobes.tangent};
    var mgLobes=physicalValues(Nk,coatBase,(w1-w0).xyz,(w2-w0).xyz,screenFace,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),tangents,HAS_TANGENT);
    mgLobes.coatRough=max(mgLobes.coatRough,curvature);
    if(!physicalLobeless(mgLobes)){${sink.store('mgLobes')}${flags}|=${PHYSICAL_SURFACE_FLAG}u;}
   }
`
    : ''
  return specular || lobed
    ? `  if((page.flags&${FLAG_LIT}u)!=0u){
   ${specular}
${lobed}  }
`
    : ''
}

/** The lobe mark of the first closure when only a closure past it has a lobe: the pixel is then of the class that holds lobes (`PHYSICAL_SURFACE_FLAG`) and its first closure reads an empty texel, which lights as the standard lobe. */
const markLobes = (g: CompiledGraph, count: number) =>
  !Array.from({ length: count - 1 }, (_, i) => wiredBy(g, i + 1)).some(
    (wired) => wired('anisotropy') || wired('clearCoat') || wired('cloth'),
  )
    ? ''
    : ` if(HAS_PHYSICAL&&physicalOn&&(page.flags&${FLAG_LIT}u)!=0u&&(flag&${PHYSICAL_SURFACE_FLAG}u)==0u&&((${Array.from({ length: count - 1 }, (_, i) => `closureOuts[${i + 1}].flags`).join('|')})&${PHYSICAL_SURFACE_FLAG}u)!=0u){
  textureStore(lobesOutput,vec2i(pos.xy),physicalTexel(PhysicalLobes(vec3f(0.0,0.0,1.0),vec3f(0.0,0.0,1.0),0.0,0.0,0.0,vec3f(0.0),0.0,-1.0)));
  flag|=${PHYSICAL_SURFACE_FLAG}u;
 }
`

/** What the closure writer gives the resolve of a program of several closures. */
export interface ClosureWriter {
  /** The declarations: the closures' private values and their store. */
  readonly decl: WgslDecl
  /** The statements before the surface is returned: the blend of the first closure where it is blended, the coverages and the
   *  closures past the first. */
  readonly after: string
  /** The call that stores them, after the surface's. */
  readonly store: string
  /** The statements a shade that keeps no closure targets runs in their place (a hit of the path tracer): the emission of every closure past the first, weighed by its coverage, added to the surface's. */
  readonly emission: string
  /** The statements a shade of the path tracer's hit runs in their place when the hit keeps its slab's weight: the emission as above, and one closure chosen among all by resampling on their weights (a closure's coverage times the luminance weight its tops leave it, times the colour it sends back), its colour, metalness, normal and roughness taking the surface's, and the weight the light of the chosen one is multiplied by, `hitSlabWeight`: its coverage times the sum of the weights over its own, the weights being the coverage times the colour the slab sends back (`hitSlabAlbedo`), so that the light of a slab counts with its coverage and the choice leaves the sum of the slabs' lights unbiased. */
  readonly choice: string
  /** The first closure's blend, run before the first closure's outputs are read, where it is blended from several slabs. */
  readonly first?: {
    readonly before: string
    readonly call: OutputCall
    /** Whether a slab of the blend wires a normal. */
    readonly normal: boolean
  }
  /** Whether a closure wires a normal: the page's tangents are decoded. */
  readonly normal: boolean
}

const writers = new WeakMap<CompiledGraph, ClosureWriter | undefined>()

/**
 * THE CLOSURE WRITER of the surface resolve, for the class of a program whose material has several closures (a closure tree that
 * flattens to more than one): beside the surface it writes as ever — the first closure's —, each closure's coverage in its word layer
 * and each closure past the first in the colour layers the record holds for them (`SURFACE_CLOSURES`), where the record holds them
 * (the head's layers word names the first of those layers and the closures held; a view whose most is one closure holds none and the
 * writer does nothing). A closure is the attributes of its slab; a closure blended from several slabs is their mix (`blendBody`). The
 * coverage is the product of the closure's terms from the tree's root (a weight, a mix's share), times the blended subtree's own.
 * The closure offsets word follows, as the reference packs them: the slice of each closure, relative.
 */
export function closureWriter(g: CompiledGraph): ClosureWriter | undefined {
  if (!writers.has(g)) writers.set(g, writerOf(g))
  return writers.get(g)
}

/** The closure writer of `g`, none where its material has one closure at full coverage. */
function writerOf(g: CompiledGraph): ClosureWriter | undefined {
  const flat = g.closures?.flat.closures
  // One closure has a writer only where a weight scales it (kept as the coverage the record holds, `closureSlotsOf`).
  if (!flat || (flat.length < 2 && !carriesWeight(flat[0]))) return undefined
  const blends = g.closures!.blends
  const wires = (k: number, name: ClosureOutput) =>
    flat[k].members.some((m) => g.closures!.slabs.get(m.slab)?.[name])
  const normal = flat.some((_, k) => k > 0 && wires(k, 'normal'))
  const bodies = flat.map((closure, k) => {
    const blended = closure.members.length > 1 ? `mgBlend${k}` : undefined
    const blendLine = blended
      ? `let ${blended}=${blends.get(closure.root)}(mgPixel,mgGiven);\n`
      : ''
    const share = coverageOf(g, k, blended)
    const layer = layerFactor(g, k)
    // The base's light is attenuated going down and coming back, both by the tops' uncovered share: the view's (`LuminanceWeightV`) and the light's (`LuminanceWeight`, one minus the coverage above).
    const layerLine = layer ? `  let mgLayer=${layer};\n` : ''
    const coverage = layer
      ? `closureOuts[${k}].coverage=closureWeightedWord(${share},mgLayer*mgLayer);`
      : `closureOuts[${k}].coverage=closureCoverageWord(${share});`
    const weight = `saturate(${share})${layer ? '*mgLayer*mgLayer' : ''}`
    if (k === 0) {
      // The first closure's emission is weighed by its coverage and what the tops leave it, as every closure's (the reference's emission is the BSDF's times its luminance weight, SubstrateExport.ush:200).
      const own =
        share === '1.0' && !layer
          ? ''
          : ` {\n${layerLine}  emissive*=saturate(${share})${layer ? '*mgLayer' : ''};\n }\n`
      return {
        blended,
        blendLine,
        text: layer ? ` {\n${layerLine}  ${coverage}\n }\n${own}` : `  ${coverage}\n${own}`,
        emission: own,
        pick: ` {\n${layerLine}  mgCover=${weight};\n  mgPick=mgCover*hitSlabAlbedo(rgb,metal,rough,N,specularOfFlags(flag));\n  ptRisAccept(&mgRis,mgPick);\n }\n`,
      }
    }
    const call = closureCall(g, k, blended)
    const held = heldOutputs(g, call)
    // The closure's own specular weighs it in the choice where its slab wires one, the default otherwise.
    const slabSpecular = wiredBy(g, k)('specular') ? held.specular : '0.5'
    const bends = wires(k, 'normal')
    // The closure's emission joins the pixel's, weighed by its coverage as the reference sums the emission of its BSDFs.
    const emits =
      held.emissive === 'vec3f(0.0)'
        ? ''
        : `  emissive+=${held.emissive}*saturate(${share})${layer ? '*mgLayer' : ''};\n`
    const bent = bends
      ? ` var mgTk=tangents.T;var mgBk=tangents.B;
  if(!HAS_TANGENT){
   let frame=cotangentFrame(mgN0,(w1-w0).xyz,(w2-w0).xyz,physicalCoords[0].d1,physicalCoords[0].d2);
   mgTk=frame.T*screenFace;mgBk=frame.B*screenFace;
  }
  Nk=bendNormal(mgN0,mgTk,mgBk,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),${call('normal')});
`
      : ''
    // The closure's own normal and blend, which its attributes are read under.
    const opened = `  mgPixel.pixelNormal=mgN0;
  ${blendLine}var Nk=mgN0;
${bent}  mgPixel.pixelNormal=Nk;
`
    return {
      blended,
      blendLine,
      emission: emits ? ` {\n${opened}${layerLine}${emits} }\n` : '',
      pick: ` {
${opened}${layerLine}  let mgW=${weight};
  let mgRgb=${held.rgb};let mgMetal=ormMetalness(1.0,${held.metallic});let mgRough=max(ormRoughness(1.0,${held.roughness}),curvature);
  let mgC=mgW*hitSlabAlbedo(mgRgb,mgMetal,mgRough,Nk,${slabSpecular});
  if(mgC>0.0&&ptRisAccept(&mgRis,mgC)){
   rgb=mgRgb;metal=mgMetal;N=Nk;rough=mgRough;mgPick=mgC;mgCover=mgW;
   // The chosen closure's own specular and lobes replace the first closure's in the hit's flags and lobes record.
   var mgKFlags=0u;
${closureLobes(g, k, call, held, wiredBy(g, k), { flags: 'mgKFlags', store: (lobes) => `hitLobes=${lobes};` })}   flag=(flag&~${PHYSICAL_SURFACE_FLAG | SPECULAR_FLAG_MASK}u)|mgKFlags;
  }
${emits} }
`,
      text: ` if(mgHeld.y>${k}u){
${opened}${layerLine}  closureOuts[${k}].baseMetal=vec4f(${held.rgb},ormMetalness(1.0,${held.metallic}));
  closureOuts[${k}].normalRough=vec4f(Nk,max(ormRoughness(1.0,${held.roughness}),curvature));
  ${coverage}
${closureLobes(g, k, call, held, wiredBy(g, k), {
  flags: `closureOuts[${k}].flags`,
  store: (lobes) => `closureOuts[${k}].lobes=physicalTexel(${lobes});`,
})}${emits} }
`,
    }
  })
  const count = flat.length
  const stores = flat
    .map((_, k) => {
      const layer = closureCoverageLayer(k)
      const slice = (i: number) => `held.x+${(k - 1) * SURFACE_CLOSURES.colours + i}u`
      const own = `closureFlagsLayerOf(held.y,${k}u)`
      const colours =
        k === 0
          ? ''
          : `textureStore(coloursOut,at,${slice(0)},closureOuts[${k}].baseMetal);textureStore(coloursOut,at,${slice(1)},closureOuts[${k}].normalRough);
  textureStore(wordsOut,at,${own},vec4u((closureBase&~${PHYSICAL_SURFACE_FLAG | SPECULAR_FLAG_MASK}u)|closureOuts[${k}].flags,0u,0u,0u));
  if((closureOuts[${k}].flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){${[0, 1, 2, 3].map((i) => `textureStore(wordsOut,at,${own}+${i + 1}u,vec4u(closureOuts[${k}].lobes[${i}],0u,0u,0u));`).join('')}}`
      return `if(${k}u<held.y&&closureOuts[${k}].coverage!=0u){textureStore(wordsOut,at,${layer}u,vec4u(closureOuts[${k}].coverage,0u,0u,0u));${colours}}`
    })
    .join('\n ')
  const decl = wgslBlock(
    `shadeClosures(${g.hash})`,
    [
      SHADE_OUTPUTS_WGSL,
      PHYSICAL_RESOLVE_WGSL,
      PHYSICAL_TEXEL_WGSL,
      specularFlag,
      closureFlagsLayerOf,
      closureOffsetsLayerOf,
    ],
    `struct ClosureOut{baseMetal:vec4f,normalRough:vec4f,coverage:u32,flags:u32,lobes:vec4u,}
var<private> closureOuts:array<ClosureOut,${count}>;
/** The pixel's surface flags with the closures' marks, which the flags of a closure past the first are made of (the pixel's, but for its own specular and lobe mark). */
var<private> closureBase:u32;
/** The coverage word of a closure of coverage \`c\`: present, its coverage in sixteen bits and the full luminance weight. */
fn closureCoverageWord(c:f32)->u32{return ${COVERAGE_PRESENT}u|u32(round(saturate(c)*${COVERAGE_MAX}.0))|(${LUMINANCE_MAX}u<<${LUMINANCE_SHIFT}u);}
/** The same with the luminance weight w the tops above the closure leave it. */
fn closureWeightedWord(c:f32,w:f32)->u32{return ${COVERAGE_PRESENT}u|u32(round(saturate(c)*${COVERAGE_MAX}.0))|(u32(round(saturate(w)*${LUMINANCE_MAX}.0))<<${LUMINANCE_SHIFT}u);}
/** The first colour layer of the closure slices and the closures the record holds, from the head's layers word. */
fn surfaceClosures()->vec2u{let word=binsWord(SHADE_BIN_LAYERS,0u).x;return vec2u((word>>${SURFACE_CLOSURES.headShift.colours}u)&255u,word>>${SURFACE_CLOSURES.headShift.held}u);}
/** The closure offsets word of a pixel of \`n\` closures (\`closureOffsetsOf\`): a step of one for each closure past the first, none past the eight a word packs. */
fn closureOffsets(n:u32)->u32{return select(${closureOffsetsOf(MAX_CLOSURES)}u&((1u<<(${SURFACE_CLOSURE_OFFSET_BITS}u*n))-1u),${closureOffsetsOf(MAX_CLOSURES)}u,n>=${MAX_CLOSURES}u);}
/** The closures of pixel \`at\`: their coverages and the closures past the first, in the layers the record holds, and the closure offsets. */
fn storeClosures(at:vec2u){
 let held=surfaceClosures();
 if(held.y<2u||closureOuts[0].coverage==0u){return;}
 ${stores}
 textureStore(wordsOut,at,closureOffsetsLayerOf(held.y),vec4u(closureOffsets(min(${count}u,held.y)),0u,0u,0u));
}`,
  )
  const first = bodies[0]
  return {
    decl,
    normal,
    store: ' storeClosures(at.xy);\n',
    emission: bodies.map((b) => b.emission).join(''),
    choice: ` var mgRis=ptRisStart(hitSlabRand);
 var mgPick=0.0;
 var mgCover=0.0;
${bodies[0].emission}${bodies.map((b) => b.pick).join('')} hitSlabWeight=select(1.0,mgRis.sum*mgCover/mgPick,mgPick>0.0);
`,
    after: ` // The closures: every one's coverage, and the ones past the first from their slabs.
 let mgHeld=surfaceClosures();
${bodies.map((b) => b.text).join('')}${markLobes(g, count)} closureBase=flag|emissiveAoFlag(emissive,ao);
`,
    first: first.blended
      ? {
          before: `  ${first.blendLine}`,
          call: closureCall(g, 0, first.blended),
          normal: wires(0, 'normal'),
        }
      : undefined,
  }
}
