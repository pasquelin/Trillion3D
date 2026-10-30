/**
 * THE TILES OF THE CLASSIFICATION OVER THE IMAGE (`sampledLightsVisualizeTileClassification`): each tile of the lists the classification made (`tileWgsl.ts`) a filled square in the
 * colour of its type — simple green, single yellow, complex red, empty none —, a rectangle light's or a textured one's tile pushed a fifth toward red, with a white outline;
 * and a table of the count of tiles of each type, in the colour of the type. The view's tiles (odd values 1, 3, 5) or the downsampled view's (even values).
 */
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { SAMPLED_TILE, SAMPLED_TILE_MODES, SAMPLED_TILE_SIZE } from '../parameters.ts'
import { DEBUG_COLORS, type DebugLines } from '../../../hair/debugLines.ts'

/** The names the table writes, by tile mode. */
export const TILE_NAMES = [
  'Simple',
  'Complex',
  'Simple Rect',
  'Complex Rect',
  'Simple Textured Rect',
  'Complex Textured Rect',
  'Empty',
  'Single',
  'Single Rect',
  'Single Textured Rect',
] as const

/** The colour of a tile mode (r, g, b), the reference's palette: rectangle and textured lights' tiles a fifth toward red. */
export function tileColor(mode: number): readonly [number, number, number] {
  const T = SAMPLED_TILE
  const kind =
    mode === T.simple || mode === T.simpleRect || mode === T.simpleRectTextured
      ? [0.5, 0.75, 0.5]
      : mode === T.single || mode === T.singleRect || mode === T.singleRectTextured
        ? [1, 1, 0]
        : mode === T.empty
          ? [189 / 255, 195 / 255, 199 / 255]
          : [0.75, 0.5, 0.5]
  const rect = mode === T.simpleRect || mode === T.complexRect || mode === T.singleRect
  const textured =
    mode === T.simpleRectTextured || mode === T.complexRectTextured || mode === T.singleRectTextured
  let [r, g, b] = kind as [number, number, number]
  for (const toward of [rect || textured, textured]) {
    if (!toward) continue
    r += (1 - r) * 0.2
    g -= g * 0.2
    b -= b * 0.2
  }
  return [r, g, b]
}

/** Which tile list a value of the setting asks for (`downsampled`) and for which input (0 the surfaces, 1 the hair strands, 2 the nearest translucent layer). */
export const tileClassificationOf = (value: number) => ({
  input: Math.floor((value - 1) / 2),
  downsampled: value % 2 === 0,
})

const tileColourList = Array.from({ length: SAMPLED_TILE_MODES }, (_, mode) => {
  const [r, g, b] = tileColor(mode)
  return `vec3f(${r},${g},${b})`
}).join(',')

export const TILE_OVERLAY_WGSL = `struct Tiles{scale:vec2f,tilePixels:f32,stride:u32,empty:u32,pad0:u32,pad1:u32,pad2:u32}
@group(0) @binding(0) var<uniform> tiles:Tiles;
@group(0) @binding(1) var<storage,read> counts:array<u32>;
@group(0) @binding(2) var<storage,read> lists:array<u32>;
@group(0) @binding(3) var<uniform> display:vec4f;
struct Out{@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) @interpolate(flat) colour:vec3f}
const CORNERS=array<vec2f,6>(vec2f(0.0,0.0),vec2f(1.0,0.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,0.0),vec2f(1.0,1.0));
const COLOURS=array<vec3f,${SAMPLED_TILE_MODES}>(${tileColourList});
@vertex fn tileVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 var o:Out;
 let mode=instance/tiles.stride;
 let index=instance%tiles.stride;
 o.position=vec4f(2.0,2.0,2.0,1.0);
 if(mode>=${SAMPLED_TILE_MODES}u||mode==tiles.empty||index>=counts[mode]){return o;}
 let packed=lists[mode*tiles.stride+index];
 let tile=vec2f(f32(packed&0xFFFFu),f32(packed>>16u));
 let corner=CORNERS[vertex];
 let pixel=(tile+corner)*tiles.tilePixels*tiles.scale;
 o.position=vec4f(pixel.x/display.x*2.0-1.0,1.0-pixel.y/display.y*2.0,0.0,1.0);
 o.local=corner;
 o.colour=COLOURS[mode];
 return o;
}
@fragment fn tileFs(i:Out)->@location(0) vec4f{
 let edge=1.0/max(tiles.tilePixels*tiles.scale.x,2.0);
 if(i.local.x<edge||i.local.y<edge||i.local.x>1.0-edge||i.local.y>1.0-edge){return vec4f(1.0);}
 return vec4f(i.colour,0.75);
}`

/** The words of the overlay's block (`Tiles`). */
const BLOCK_WORDS = 8

/** The overlay's pipeline and block, made when the view first shows. */
export function createTileOverlay(device: GPUDevice) {
  const module = device.createShaderModule({
    label: 'Trillion3D sampled tile overlay',
    code: TILE_OVERLAY_WGSL,
  })
  const pipeline = preparedPipeline(device, {
    label: 'Trillion3D sampled tile overlay',
    layout: 'auto',
    vertex: { module, entryPoint: 'tileVs' },
    fragment: {
      module,
      entryPoint: 'tileFs',
      targets: [
        {
          format: DISPLAY_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  }).ask()
  const block = device.createBuffer({
    label: 'Trillion3D sampled tile overlay block',
    size: BLOCK_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const displayBlock = device.createBuffer({
    label: 'Trillion3D sampled tile overlay display',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    /**
     * Draws the tiles of `lists` (`counts` a count per mode, `stride` the words of one mode's list) over `target`: a tile of `factor` times the classification's tile edge, the view's
     * pixels turned to the display's by `scale`.
     */
    encode(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      display: readonly [number, number],
      scale: readonly [number, number],
      factor: number,
      stride: number,
      counts: GPUBuffer,
      lists: GPUBuffer,
    ) {
      const draw = pipeline.get()
      if (!draw) return
      const words = new ArrayBuffer(BLOCK_WORDS * 4)
      new Float32Array(words).set([scale[0], scale[1], SAMPLED_TILE_SIZE * factor])
      new Uint32Array(words).set([stride, SAMPLED_TILE.empty], 3)
      device.queue.writeBuffer(block, 0, words)
      device.queue.writeBuffer(displayBlock, 0, new Float32Array([display[0], display[1], 0, 0]))
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D sampled tile overlay',
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(draw)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: draw.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: block } },
            { binding: 1, resource: { buffer: counts } },
            { binding: 2, resource: { buffer: lists } },
            { binding: 3, resource: { buffer: displayBlock } },
          ],
        }),
      )
      pass.draw(6, SAMPLED_TILE_MODES * stride)
      pass.end()
    },
    dispose() {
      block.destroy()
      displayBlock.destroy()
    },
  }
}

/** Writes the table of the tile counts (`counts`, a count per mode) from the pixel (`x`, `y`): the header, then a row a mode in the colour of its tile. */
export function writeTileTable(
  lines: DebugLines,
  counts: ArrayLike<number>,
  x: number,
  y: number,
  line: number,
) {
  lines.text('TileType             | Num', x, y, DEBUG_COLORS.silver)
  for (let mode = 0; mode < SAMPLED_TILE_MODES; mode++) {
    const [r, g, b] = tileColor(mode)
    lines.text(
      `${TILE_NAMES[mode]!.padEnd(21)}: ${counts[mode] ?? 0}`,
      x,
      (y += line),
      packColor(r, g, b),
    )
  }
}

const packColor = (r: number, g: number, b: number) =>
  (Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16) | (255 << 24)) >>>
  0
