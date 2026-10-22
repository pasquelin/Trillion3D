import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import { fallbackOf } from '../../materials/graph/program.ts'
import { graphLoadWgsl } from '../../materials/graph/tableValues.ts'
import { requestLoopFn } from '../../materials/virtual/requestWgsl.ts'

/**
 * WHAT THE SURFACE RESOLVE ADDS FOR A GRAPH (`shadeShader`'s `graph`): the module of a class of a
 * graph's program holds the program's functions (`materials/graph/program.ts`), reads its values from
 * the material table beside the surface's record (`graphLoadWgsl`) and runs them at the pixel in
 * place of the surface's maps and factors. The pieces below are spliced into `shadeSurface` where
 * the maps were read: the context of the pixel (`prologue`), the colours of the diagnostic views
 * (`diagnostic`), the normal and the outputs once the vertex normal is known (`late`), the thin
 * transmission (`thin`); the tile requests of its textures replace the maps' (`shadeRequestWgsl`).
 *
 * An output the graph does not wire takes its default (`fallbackOf`); the outputs are cast and held
 * as the reference holds them: the base colour, the metalness, the roughness and the occlusion
 * saturated, the emission not below zero. The footprint of a texture read is found by evaluating its
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
}

/** The code that calls the output `name` at the pixel, or its default where nothing is wired. */
const outputOf = (g: CompiledGraph, name: GraphOutput) => {
  const fn = g.functions[name]
  return fn ? `${fn}(mgPixel,mgGiven)` : fallbackOf(name).code
}

/** The pixel's context and the values it reads, held for the tile request too. */
const pixelWgsl = (g: CompiledGraph) =>
  wgslBlock(
    `shadeGraphPixel(${g.hash})`,
    [graphLoadWgsl(g, SHADE_BINDINGS.material)],
    `var<private> mgPixel:MgContext;
var<private> mgGiven:${g.values};`,
  )

/** The pixel's four texture sets, then the first again for the four a page does not carry. */
const SETS = (at: string) =>
  `array<vec2f,8>(${[0, 1, 2, 3].map((s) => `physicalCoords[${s}].${at}`).join(',')},${[0, 0, 0, 0].map(() => `physicalCoords[0].${at}`).join(',')})`

/** The context at the pixel, and at the pixels the footprint is found at where a texture is read. */
function prologue(g: CompiledGraph, displaced: boolean) {
  const neighbours = g.uses.textures || !!g.functions.normal
  const near = (at: string, step: 'ddx' | 'ddy', by: string) =>
    `mgNeighbour[${at}]=mgPixel;mgNeighbour[${at}].uvs=array<vec2f,8>(${[0, 1, 2, 3]
      .map((s) => `physicalCoords[${s}].uv+physicalCoords[${s}].${step}`)
      .join(
        ',',
      )},${[0, 0, 0, 0].map(() => `physicalCoords[0].uv+physicalCoords[0].${step}`).join(',')});
 mgNeighbour[${at}].world=(w0*${by}.x+w1*${by}.y+w2*${by}.z).xyz;`
  return ` // The graph: its values from the record, the pixel's context, and the neighbours' for footprints.
 mgGiven=mgLoad${g.suffix}(max(m.graph,1u)-1u);
 mgPixel.uvs=${SETS('uv')};
 mgPixel.world=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 mgPixel.eye=uni.eye;mgPixel.origin=page.world[3].xyz;
 mgPixel.time=uni.time;mgPixel.realTime=uni.time;
 mgPixel.vertexNormal=unitOrZero(t.n0*bary.x+t.n1*bary.y+t.n2*bary.z);
 mgPixel.pixelNormal=mgPixel.vertexNormal;
${
  neighbours
    ? ` var mgbx=perspectiveBarycentric(s0,s1,s2,t.iw,p+vec2f(1.0,0.0),area);
 var mgby=perspectiveBarycentric(s0,s1,s2,t.iw,p+vec2f(0.0,1.0),area);
${displaced ? ' if(solved){mgbx=bary+stepX;mgby=bary+stepY;}\n' : ''} ${near('0', 'ddx', 'mgbx')}
 ${near('1', 'ddy', 'mgby')}
`
    : ''
}`
}

/** The normal the graph wires, in tangent space, bends the vertex normal as a normal map does; the
 *  other outputs are then read at the pixel's normal. */
function late(g: CompiledGraph) {
  const normal = g.functions.normal
    ? `  mgPixel.vertexNormal=N;mgPixel.pixelNormal=N;
  var mgT=tangents.T;var mgB=tangents.B;
  if(!HAS_TANGENT){
   let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,physicalCoords[0].d1,physicalCoords[0].d2);
   mgT=frame.T*screenFace;mgB=frame.B*screenFace;
  }
  let mgFlip=select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL);
  let mgMap=${g.functions.normal}(mgPixel,mgGiven);
  let mgMapX=${g.functions.normal}(mgNeighbour[0],mgGiven);
  let mgMapY=${g.functions.normal}(mgNeighbour[1],mgGiven);
  N=bendNormal(N,mgT,mgB,mgFlip,mgMap);
  Nx=bendNormal(Nx,mgT,mgB,mgFlip,mgMapX);
  Ny=bendNormal(Ny,mgT,mgB,mgFlip,mgMapY);
`
    : ''
  return `${normal}  // The graph's outputs at the pixel, held as the reference holds them.
  mgPixel.pixelNormal=N;
  rgb=saturate(${outputOf(g, 'baseColor')});
  metal=ormMetalness(1.0,${outputOf(g, 'metallic')});
  rough=ormRoughness(1.0,saturate(${outputOf(g, 'roughness')}));
  emissive=max(${outputOf(g, 'emissive')},vec3f(0.0));
  ao=saturate(${outputOf(g, 'ambientOcclusion')});
`
}

/** The tile requests: a pixel asks one of the graph's texture reads, named by its position, as it asks one of a surface's maps. */
export function shadeRequestWgsl(g: CompiledGraph) {
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

/** The pieces the surface resolve splices for the program `g`; `displaced` where the module places
 *  its pixels on a displaced triangle, whose neighbours' weights are its own (`DISPLACED_STEPS`). */
export function shadeGraph(g: CompiledGraph, displaced: boolean): ShadeGraph {
  return {
    decl: pixelWgsl(g),
    request: shadeRequestWgsl(g),
    sets: `|${g.uses.sets}u`,
    prologue: prologue(g, displaced),
    diagnostic: `  base=saturate(${outputOf(g, 'baseColor')})+max(${outputOf(g, 'emissive')},vec3f(0.0));\n`,
    normal: !!g.functions.normal,
    late: late(g),
    thin: g.functions.subsurfaceColor
      ? `  thin=clamp(${outputOf(g, 'subsurfaceColor')},vec3f(0.0),vec3f(1.0));\n`
      : '',
  }
}
