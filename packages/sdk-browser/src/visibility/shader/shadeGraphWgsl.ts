import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import { FLAG_LIT } from '../types.ts'
import { PHYSICAL_MAP_FIELDS } from '../materialType.ts'
import { GRAPH_SHADING_MODELS } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import {
  MODEL_FLAG,
  SURFACE_MODEL_MASK,
  UNLIT_FLAG,
} from '../../materials/surface/surfaceModelWord.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import {
  graphLobes,
  heldOutputs,
  outputCall,
  type OutputCall,
} from '../../materials/graph/outputsOf.ts'
import { VIEW_FORWARD_WGSL } from '../../materials/graph/program.ts'
import { graphLoadWgsl } from '../../materials/graph/tableValues.ts'
import { SPECULAR_FLAG_MASK, specularFlag } from '../../materials/surface/surfaceSpecular.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { SUBSURFACE_OPACITY_THRESHOLD } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { requestLoopFn } from '../../materials/virtual/requestWgsl.ts'
import { NEIGHBOUR_WEIGHTS } from './shadeVariantsWgsl.ts'

/**
 * WHAT THE SURFACE RESOLVE ADDS FOR A GRAPH (`shadeShader`'s `graph`): the module of a class of a
 * graph's program holds the program's functions (`materials/graph/program.ts`), reads its values from
 * the material table beside the surface's record (`graphLoadWgsl`) and runs them at the pixel in
 * place of the surface's maps and factors. The pieces below are spliced into `shadeSurface` where
 * the maps were read: the context of the pixel (`prologue`), the colours of the diagnostic views
 * (`diagnostic`), the normal and the outputs once the vertex normal is known (`late`), the thin
 * transmission (`thin`), the specular (`specular`) and the lobes (`lobes`); the tile requests of its
 * textures replace the maps' (`shadeRequestWgsl`).
 *
 * An output the graph does not wire takes its default (`fallbackOf`); the outputs are cast and held
 * as a shader holds them (`heldOutputs`). The footprint of a texture read is found by evaluating its
 * coordinate at the pixel a pixel to the right and a pixel below (`mgNeighbour`): the pixel's
 * coordinate sets plus their derivatives, and its world position at the next pixels' weights, are
 * what the hardware's derivative of the coordinate is.
 */
export interface ShadeGraph {
  /** The declarations the module lists: the program, its loader, the pixel's context and values. */
  readonly decl: WgslDecl
  /** The tile requests of its textures. */
  readonly request: WgslDecl
  /** The texture sets it reads, as the mask `physicalOtherUvs` decodes them by. */
  readonly sets: string
  readonly prologue: string
  readonly diagnostic: string
  /** Whether it wires a normal: the page's tangents are then decoded. */
  readonly normal: boolean
  readonly late: string
  readonly thin: string
  /** Where it wires the shading model: an unlit pixel leaves unlit, in the surface flags. */
  readonly model: string
  /** Where it wires the specular, the flag that leaves it in the surface flags of a lit pixel. */
  readonly specular: string
  /** The lobes it wires, set in the pixel's lobe record before the record's own call stores them
   *  (`PHYSICAL_LOBES_CALL`); none where it wires neither. */
  readonly lobes?: string
}

type Held = ReturnType<typeof heldOutputs>

/** The pixel's context and the values it reads, held for the tile request too. */
const pixelWgsl = (g: CompiledGraph) =>
  wgslBlock(
    `shadeGraphPixel(${g.hash})`,
    [
      graphLoadWgsl(g, SHADE_BINDINGS.material),
      VIEW_FORWARD_WGSL,
      ...(g.functions.specular ? [specularFlag] : []),
    ],
    `var<private> mgPixel:MgContext;
var<private> mgGiven:${g.values};`,
  )

/** The pixel's texture sets, a set the page does not carry holding the first (`physicalCoords`). */
const SETS = (at: string) =>
  `array<vec2f,${MAX_UV_SETS}>(${Array.from({ length: MAX_UV_SETS }, (_, s) => `physicalCoords[${s}].${at}`).join(',')})`

/** The vertex colour at the pixel, perspective-correct as the texture coordinate is, white where the
 *  geometry has none (the row carries it: `FLAG_HAS_COLOR`). */
const VERTEX_COLOR = ` mgPixel.vertexColor=vec4f(1.0);
 if(HAS_VERTEX_COLOR){
  mgPixel.vertexColor=pageColor(page,t.h,t.k.x)*bary.x+pageColor(page,t.h,t.k.y)*bary.y+pageColor(page,t.h,t.k.z)*bary.z;
 }
`

/** The context at the pixel, and at the pixels the footprint is found at where a texture is read. */
function prologue(g: CompiledGraph, displaced: boolean) {
  const neighbours = g.uses.textures || !!g.functions.normal
  const near = (at: string, step: 'ddx' | 'ddy', by: string) =>
    `mgNeighbour[${at}]=mgPixel;mgNeighbour[${at}].uvs=array<vec2f,${MAX_UV_SETS}>(${Array.from(
      { length: MAX_UV_SETS },
      (_, s) => `physicalCoords[${s}].uv+physicalCoords[${s}].${step}`,
    ).join(',')});
 mgNeighbour[${at}].world=(w0*${by}.x+w1*${by}.y+w2*${by}.z).xyz;`
  return ` // The graph: its values from the record, the pixel's context, and the neighbours' for footprints.
 mgGiven=mgLoad${g.suffix}(max(m.graph,1u)-1u);
 mgPixel.uvs=${SETS('uv')};
 mgPixel.world=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 mgPixel.eye=uni.eye;mgPixel.origin=page.world[3].xyz;
 mgPixel.time=uni.time;mgPixel.realTime=uni.realTime;
 mgPixel.vertexNormal=unitOrZero(t.n0*bary.x+t.n1*bary.y+t.n2*bary.z);
 mgPixel.pixelNormal=mgPixel.vertexNormal;
 mgPixel.viewForward=mgViewForward(uni.viewProj,uni.eye,mgPixel.world);
${g.uses.colour ? VERTEX_COLOR : ''}${NEIGHBOUR_WEIGHTS(displaced, ' ')}${
    neighbours
      ? ` ${near('0', 'ddx', 'bx')}
 ${near('1', 'ddy', 'by')}
`
      : ''
  }`
}

/** The normal the graph wires, in tangent space, bends the vertex normal as a normal map does; the
 *  other outputs are then read at the pixel's normal. */
function late(g: CompiledGraph, held: Held, call: OutputCall) {
  const normal = g.functions.normal
    ? `  mgPixel.vertexNormal=N;mgPixel.pixelNormal=N;
  var mgT=tangents.T;var mgB=tangents.B;
  if(!HAS_TANGENT){
   let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,physicalCoords[0].d1,physicalCoords[0].d2);
   mgT=frame.T*screenFace;mgB=frame.B*screenFace;
  }
  let mgFlip=select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL);
  let mgMap=${g.functions.normal}(mgPixel,mgGiven);
  N=bendNormal(N,mgT,mgB,mgFlip,mgMap);
`
    : ''
  return `${normal}  // The graph's outputs at the pixel, held as a shader holds them.
  mgPixel.pixelNormal=N;
  rgb=${held.rgb};
  metal=ormMetalness(1.0,${held.metallic});
  rough=ormRoughness(1.0,${held.roughness});
  emissive=${held.emissive};
  ao=${held.occlusion};
${model(g, held, call)}`
}

/** The pixel's shading model (`GRAPH_SHADING_MODELS`), where the graph wires one: the number its
 *  output gives, rounded. An unlit pixel shows its emission alone, as a surface that is not lit does
 *  (`heldOutputs`): no colour, no metalness, no occlusion. */
function model(g: CompiledGraph, held: Held, call: OutputCall) {
  if (!g.functions.shadingModel) return ''
  return `  let mgModel=i32(round(${call('shadingModel')}));
  if(mgModel==${GRAPH_SHADING_MODELS.unlit}){rgb=${held.emission};emissive=vec3f(0.0);metal=0.0;ao=1.0;}
`
}

/**
 * The lobes the graph wires, set in the pixel's lobe record in place of the surface's own (a graph's
 * surface has none of the material's factors or maps: `lobeRecord.ts`), before the record's call
 * stores them as it stores any (`PHYSICAL_LOBES_CALL`): the anisotropy's strength, its tangent and
 * the clear coat with its roughness (`graphLobes`).
 */
function lobesHook(g: CompiledGraph, call: OutputCall) {
  const lobes = graphLobes(
    g,
    call,
    g.functions.shadingModel
      ? {
          coat: `mgModel==${GRAPH_SHADING_MODELS.clearCoat}`,
          cloth: `mgModel==${GRAPH_SHADING_MODELS.cloth}`,
        }
      : {},
  )
  if (!lobes) return undefined
  return `if(physicalOn){
  ${lobes.prelude}
  physicalRecord.lobes=${lobes.lobes};
  physicalRecord.maps=array<u32,${PHYSICAL_MAP_FIELDS.length}>();
  physicalRecord.sheen=${lobes.sheen};
  physicalRecord.law=${lobes.law};
  physicalTangent=${lobes.tangent};
 }
 `
}

/** The tile requests: a pixel asks one of the graph's texture reads, named by its position, as it asks one of a surface's maps. */
function shadeRequestWgsl(g: CompiledGraph) {
  const text = g.reads
    ? `fn shadePick(p:RequestPick,missing:bool,m:Material)->u32{return ${g.ask}(mgPixel,mgGiven,p,missing);}
${requestLoopFn({
  head: 'fn shadeRequest(m:Material,pos:vec2f)->u32',
  pos: 'pos',
  word: 'uni.feedback',
  choices: `${g.reads}u`,
  pick: (p, missing) => `shadePick(${p},${missing},m)`,
})}`
    : 'fn shadeRequest(m:Material,pos:vec2f)->u32{return 0u;}'
  return wgslBlock(`SHADE_REQUEST_WGSL(${g.hash})`, [], text)
}

/** The thin transmission the graph's `subsurfaceColor` gives: only the two-sided foliage's own where
 *  the graph picks the model per pixel (the subsurface model's is a pixel model's, `pixelModels`), and none where it wires a cloth and picks none, the output
 *  being the cloth's fuzz colour then (`graphLobes`). */
function thinTransmission(g: CompiledGraph, call: OutputCall) {
  if (!g.functions.subsurfaceColor) return ''
  if (!g.functions.shadingModel && g.functions.cloth) return ''
  const gate = g.functions.shadingModel
    ? `  if(mgModel!=${GRAPH_SHADING_MODELS.twoSidedFoliage}){thin=vec3f(0.0);}\n`
    : ''
  return `  thin=clamp(${call('subsurfaceColor')},vec3f(0.0),vec3f(1.0));\n${gate}`
}

/**
 * The shading models a graph picks per pixel (`pixelModel.ts`), on a lit pixel of the physical model: the model's
 * number in the surface flags, and what it reads in the thin transmission's target — a skin's subsurface colour
 * and opacity; a subsurface profile's number (the material's, `subsurfaceProfileOfModel`) and opacity, a pixel of
 * an opacity at or under the threshold (`SUBSURFACE_OPACITY_THRESHOLD`) keeping the plain model; an eye's profile
 * number, its iris mask (the `clearCoat` output, as one minus it in the opacity) and either its distance
 * (`clearCoatRoughness`, left in the metalness) and the iris direction the `tangent` output gives in the world's
 * axes (octahedral, two values; (0, 0, -1) where it is not wired), or, where the iris has a normal of its own
 * (`irisNormal`, `uni.irisNormal`), the iris normal — the `clearCoatBottomNormal` output, in tangent space, the plane
 * normal where it is not wired — and the caustic normal as their differences from the surface's, in octahedral
 * coordinates, the caustic's first left in the metalness and its second in the specular.
 */
function pixelModels(g: CompiledGraph, held: Held, call: OutputCall) {
  const tangent = g.functions.tangent ? `normalize(${call('tangent')})` : 'vec3f(0.0,0.0,-1.0)'
  const plane = g.functions.tangent ? tangent : 'N'
  const bottom = g.functions.clearCoatBottomNormal
    ? `normalize(bendNormal(coatBase,mgBottomT,mgBottomB,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),${call('clearCoatBottomNormal')}))`
    : 'mgPlane'
  const caustic = g.functions.tangent
    ? 'octEncode(normalize(mix(mgPlane,-N,mgMask*mgDistance)))-mgOct'
    : 'vec2f(0.0)'
  // The iris and caustic normals as differences of octahedral coordinates, an 8-bit channel each.
  const delta = (v: string) => `quantise8x2((${v})*0.5+128.0/255.0)`
  const scatters = `!(mgModel==${PIXEL_MODEL.profile}&&${held.opacity}<=${wgslF32(SUBSURFACE_OPACITY_THRESHOLD)})`
  return `  if(isPixelModel(u32(mgModel))&&${scatters}&&(flag&${SURFACE_MODEL_MASK}u)==${MODEL_FLAG.physical}u){
   flag|=pixelModelFlag(u32(mgModel));
   if(mgModel==${PIXEL_MODEL.subsurface}){
    thinOut=clamp(${call('subsurfaceColor')},vec3f(0.0),vec3f(1.0));thinOpacity=${held.opacity};
    if(any(thinOut>vec3f(0.0))){flag|=${SUBSURFACE_FLAG}u;}
   }
   if(mgModel==${PIXEL_MODEL.skin}){thinOut=clamp(${call('subsurfaceColor')},vec3f(0.0),vec3f(1.0));thinOpacity=${held.opacity};}
   if(mgModel==${PIXEL_MODEL.profile}){thinOut=vec3f(subsurfaceProfileOfModel(m.model),0.0,0.0);thinOpacity=${held.opacity};}
   if(mgModel==${PIXEL_MODEL.eye}){
    let mgMask=saturate(${call('clearCoat')});
    let mgDistance=saturate(${call('clearCoatRoughness')});
    thinOpacity=quantise8(1.0-mgMask);
    if(uni.irisNormal==0u){
     let mgIris=quantise8x2(octEncode(${tangent})*0.5+0.5);
     thinOut=vec3f(subsurfaceProfileOfModel(m.model),mgIris.x,mgIris.y);
     metal=quantise8(mgDistance);
    }else{
${BOTTOM_FRAME}
     let mgOct=octEncode(N);
     let mgPlane=${plane};
     let mgCaustic=${delta(caustic)};
     let mgIrisDelta=${delta(`octEncode(${bottom})-mgOct`)};
     thinOut=vec3f(subsurfaceProfileOfModel(m.model),mgIrisDelta.x,mgIrisDelta.y);
     metal=mgCaustic.x;
     flag&=~${SPECULAR_FLAG_MASK}u;
     flag|=specularFlag(mgCaustic.y);
    }
   }
  }
${clearCoatBottom(g, call)}`
}

/** The frame the bottom normal, in tangent space, is carried to the world by: the page's tangents, or the
 *  one the pixel's coordinates give. */
const BOTTOM_FRAME = `     var mgBottomT=tangents.T;var mgBottomB=tangents.B;
     if(!HAS_TANGENT){
      let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,physicalCoords[0].d1,physicalCoords[0].d2);
      mgBottomT=frame.T*screenFace;mgBottomB=frame.B*screenFace;
     }`

/**
 * The clear coat's bottom normal (`clearCoatNormal`, `uni.clearCoatNormal`), where the graph wires one: the pixel's
 * normal is the coat's, the base's the `clearCoatBottomNormal` output carried to the world, as the surface buffer
 * keeps it — a difference of octahedral coordinates a quarter as large, in an 8-bit channel each.
 */
function clearCoatBottom(g: CompiledGraph, call: OutputCall) {
  if (!g.functions.clearCoatBottomNormal) return ''
  return `  if(mgModel==${GRAPH_SHADING_MODELS.clearCoat}&&uni.clearCoatNormal!=0u){
${BOTTOM_FRAME}
   let mgTopOct=octEncode(N);
   let mgBottom=normalize(bendNormal(coatBase,mgBottomT,mgBottomB,select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL),${call('clearCoatBottomNormal')}));
   let mgPacked=quantise8x2((octEncode(mgBottom)-mgTopOct)*0.25+128.0/255.0);
   coatBase=N;
   N=octDecode(mgTopOct+(mgPacked*4.0-512.0/255.0));
  }
`
}

/** The pieces the surface resolve splices for the program `g`; `displaced` where the module places
 *  its pixels on a displaced triangle, whose neighbours' weights are its own (`DISPLACED_STEPS`). */
export function shadeGraph(g: CompiledGraph, displaced: boolean): ShadeGraph {
  const call = outputCall(g, 'mgPixel,mgGiven')
  const held = heldOutputs(g, call)
  return {
    decl: pixelWgsl(g),
    request: shadeRequestWgsl(g),
    sets: `|${g.uses.sets}u`,
    prologue: prologue(g, displaced),
    diagnostic: `  base=${held.rgb}+${held.emissive};\n`,
    normal: !!g.functions.normal || !!g.functions.clearCoatBottomNormal,
    late: late(g, held, call),
    model: g.functions.shadingModel
      ? `  if(mgModel==${GRAPH_SHADING_MODELS.unlit}){flag=(flag&~${SURFACE_MODEL_MASK}u)|${UNLIT_FLAG}u;}\n${pixelModels(g, held, call)}`
      : '',
    lobes: lobesHook(g, call),
    specular: g.functions.specular
      ? `  if((page.flags&${FLAG_LIT}u)!=0u${g.functions.shadingModel ? `&&!(mgModel==${PIXEL_MODEL.eye}&&uni.irisNormal!=0u)` : ''}){flag|=specularFlag(${held.specular});}\n`
      : '',
    thin: thinTransmission(g, call),
  }
}
