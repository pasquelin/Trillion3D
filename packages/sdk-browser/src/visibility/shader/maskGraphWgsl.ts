import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import {
  maskOutput,
  maskValues,
  masksKey,
  type MaskSet,
} from '../../materials/graph/maskProgram.ts'
import type { PixelProgram } from '../../materials/graph/pixelProgram.ts'
import { depthOffsetOutput } from '../../materials/graph/pdoProgram.ts'
import { displacementOutput } from '../../materials/graph/displacementProgram.ts'
import { graphLoadWgsl } from '../../materials/graph/tableValues.ts'
import { GRAPH_HEADER } from '../../materials/table/materialLayout.ts'
import { DITHER_MODEL_BIT } from '../../materials/surface/surfaceModelWord.ts'
import { graphFrameWgsl } from './graphFrameWgsl.ts'

/**
 * THE GRAPH MASKS OF A RASTER'S MODULE (`maskKeepWgsl`): the `opacityMask` function of each program
 * the module holds (`MaskSet`), read at a pixel from the values the surface wrote beside its record
 * — its header texel names the program (`id`) — and chosen by that id. The context a raster has of a
 * pixel is its texture coordinate, the footprint of it and the clocks of the image
 * (`graphFrameWgsl.ts`): a mask that reads more is refused when it is built (`maskProgram.ts`).
 *
 * The same programs give the depth a pixel is written at (`pixelDepthOffset`, `pdoProgram.ts`): the
 * output of the program in the same context, `depthOffsetValue` of the row's surface, zero for one
 * whose program the module does not hold or that wires none (the rasters turn it into a depth,
 * `offsetDepth`, `../raster/pixelWgsl.ts`).
 *
 * `maskGraphValue` gives the output minus the clip value (the record's `cut`): the pixel is kept where
 * it is not below zero; a surface whose program the module does not hold keeps every pixel (a value
 * past any dither). `maskDithered` is the cut of a surface that asks for a dither
 * (`DITHER_MODEL_BIT`, any masked material's, not the graphs' alone), where the caller knows the pixel
 * (`pixel` not negative): its value plus `0.83 · noise − 0.5`, the engine's blue noise read at the
 * pixel and at the image's frame (the wall clock at sixty a second), so that the temporal pass
 * averages the cut into a limited translucency.
 */
const programContext = (mask: PixelProgram, footprint: string) => {
  const neighbours = mask.uses.textures
    ? ` let stepX=ddx*${footprint};let stepY=ddy*${footprint};
 mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;
 mgNeighbour[0].uvs=array<vec2f,8>(${Array(8).fill('uv+stepX').join(',')});
 mgNeighbour[1].uvs=array<vec2f,8>(${Array(8).fill('uv+stepY').join(',')});
`
    : ''
  return ` let g=mgLoad${mask.suffix}(first);
 var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(${Array(8).fill('uv').join(',')});
 ctx.time=graphFrame.clock.x;ctx.realTime=graphFrame.clock.y;
${neighbours}`
}

/** The value of a pixel that nothing cuts: far past any dither. */
const MASK_KEPT = '1.0e30'

/** An output of a pixel program a raster reads, with what each place that holds it writes: `wired` says
 *  whether a program wires it, `loader` its function over the colour read, `fn` and `params` the
 *  program function (`first` and `params` its arguments, `result` what it returns, the clip value
 *  taken off for the mask), `value` the function over the row's surface that picks the program by
 *  its id (`args` the call's arguments), `bit` the header bit that says a program wires it, `absent`
 *  the value of a surface whose header lacks it, and `doc` and `note` the comments of `value`. */
interface PixelOutput {
  readonly wired: (program: PixelProgram) => boolean
  readonly loader: (program: PixelProgram, sample: WgslDecl) => WgslDecl
  readonly fn: string
  readonly params: string
  readonly result: (suffix: string) => string
  readonly args: string
  readonly value: string
  readonly bit: number
  readonly absent: string
  readonly doc: string
  readonly note?: string
}

/** The outputs the rasters read, in the order their functions are written: the mask, the depth
 *  offset and the displacement. */
const PIXEL_OUTPUTS: readonly PixelOutput[] = [
  {
    wired: (program) => program.cuts,
    loader: maskOutput,
    fn: 'maskGraph',
    params: 'clip:f32,uv:vec2f,ddx:vec2f,ddy:vec2f',
    result: (suffix) => `mgOpacityMask${suffix}(ctx,g)-clip`,
    args: 'm.graph-1u,m.cut,uv,ddx,ddy',
    value: 'maskGraphValue',
    bit: GRAPH_HEADER.mask,
    absent: MASK_KEPT,
    doc: "The value of the graph of the row's surface `m`: its mask minus the clip value.",
    note: ' // The program ids of the two passes both start at one: only a header that says it holds a mask names one.\n',
  },
  {
    wired: (program) => program.depthOffsets,
    loader: depthOffsetOutput,
    fn: 'depthGraph',
    params: 'uv:vec2f,ddx:vec2f,ddy:vec2f',
    result: (suffix) => `mgPixelDepthOffset${suffix}(ctx,g)`,
    args: 'm.graph-1u,uv,ddx,ddy',
    value: 'depthOffsetValue',
    bit: GRAPH_HEADER.depthOffset,
    absent: '0.0',
    doc: "The depth offset of the graph of the row's surface `m`, in the world's units: zero where its\n *  program wires none.",
  },
  {
    wired: (program) => program.displaces,
    loader: displacementOutput,
    fn: 'heightGraph',
    params: 'uv:vec2f,ddx:vec2f,ddy:vec2f',
    result: (suffix) => `mgDisplacement${suffix}(ctx,g)`,
    args: 'm.graph-1u,uv,ddx,ddy',
    value: 'displacementValue',
    bit: GRAPH_HEADER.displacement,
    absent: '0.5',
    doc: "The height of the displacement of the graph of the row's surface `m`, in 0 to 1 (saturated by the\n *  caller): the half where its program wires none.",
  },
]

/** The functions of a program's outputs the rasters read (`PIXEL_OUTPUTS`), each where the program
 *  wires it. */
const programFunction = (program: PixelProgram, footprint: string) => {
  const context = programContext(program, footprint)
  return PIXEL_OUTPUTS.map((output) =>
    output.wired(program)
      ? `fn ${output.fn}${program.suffix}(first:u32,${output.params})->f32{
${context} return ${output.result(program.suffix)};
}`
      : '',
  ).join('\n')
}

/** The function of `output` over the row's surface: the program its header names, among those the
 *  module holds that wire it. */
const valueFunction = (output: PixelOutput, programs: readonly PixelProgram[]) => {
  const cases = programs
    .filter(output.wired)
    .map(
      (program) => `  case ${program.key}u:{return ${output.fn}${program.suffix}(${output.args});}`,
    )
    .join('\n')
  return `/** ${output.doc} */
fn ${output.value}(m:Material,uv:vec2f,ddx:vec2f,ddy:vec2f)->f32{
 let head=materialGraphHead(m.graph);
${output.note ?? ''} if((head.y&${output.bit}u)==0u){return ${output.absent};}
 switch(head.x){
${cases}
  default:{}
 }
 return ${output.absent};
}`
}

/** The declarations and the text a module holds for `masks`: the program functions, their loaders
 *  and the value functions (`maskGraphValue`, `depthOffsetValue`, `displacementValue`). */
export function maskGraphWgsl(masks: MaskSet): WgslDecl {
  const sample = masks.sample!
  const footprint = masks.footprint ?? '1.0'
  const { group, table } = masks.where ?? { group: 0, table: VIS_BINDINGS.material }
  const loaders = masks.programs.flatMap((program) => [
    graphLoadWgsl(maskValues(program), table, group),
    ...PIXEL_OUTPUTS.filter((output) => output.wired(program)).map((output) =>
      output.loader(program, sample),
    ),
  ])
  return wgslBlock(
    `maskGraphWgsl(${masksKey(masks)})`,
    [graphFrameWgsl(masks.frame, group), ...loaders],
    `${masks.programs.map((program) => programFunction(program, footprint)).join('\n')}
${PIXEL_OUTPUTS.map((output) => valueFunction(output, masks.programs)).join('\n')}`,
  )
}

/** The dither of a module that has the blue noise at \`masks.noise\` (and the graph frame, which says
 *  whether the noise is there: \`eye.w\`, one): \`maskDithered\` is a surface's cut value, dithered where
 *  it asks and the caller knows the pixel. */
export const maskDitherWgsl = (masks: MaskSet): WgslDecl =>
  wgslBlock(
    `maskDitherWgsl(${masks.frame}, ${masks.noise})`,
    [graphFrameWgsl(masks.frame), blueNoiseWgsl(0, masks.noise!, true)],
    `fn maskDithered(m:Material,value:f32,pixel:vec2f)->f32{
 if(pixel.x<0.0||(m.model&${DITHER_MODEL_BIT}u)==0u||graphFrame.eye.w==0.0){return value;}
 let frame=graphFrame.frame;
 return value+0.83*blueNoiseScalar(vec2u(pixel),frame)-0.5;
}`,
  )
