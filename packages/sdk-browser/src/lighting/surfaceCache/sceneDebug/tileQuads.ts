import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import type { ScreenProbeResources } from '../../bounce/screen/resources.ts'
import {
  INTEGRATE_TILE_COUNTS_AT,
  INTEGRATE_TILE_MODE_COUNT,
  INTEGRATE_TILE_SIDE,
  integrateTiles,
  type ScreenProbeGeometry,
} from '../../bounce/screen/screenProbeLayout.ts'
import { gpuLineColor, gpuLineSink, type GpuLines } from './gpuLines.ts'

/**
 * THE INTEGRATION'S TILES over the image (`screenProbeTileDebugMode`): a thread for each tile of each mode's list appends the pixels the tile covers as a quad filled half
 * transparent, green for the simple mode, orange for the importance sampled one and cyan for the complete one.
 */

const WORKGROUP = 64
/** The fill's alpha. */
const ALPHA = 0.5
const COLORS = [
  gpuLineColor(0, 1, 0, ALPHA),
  gpuLineColor(243 / 255, 156 / 255, 18 / 255, ALPHA),
  gpuLineColor(0, 1, 1, ALPHA),
]

export const tileQuadsWgsl = wgslProgram(
  `struct Tiles{grid:vec4u,scale:vec4f}
@group(0) @binding(0) var<uniform> tiles:Tiles;
@group(0) @binding(1) var<storage,read> tileList:array<u32>;
@group(0) @binding(2) var<storage,read> tileCounts:array<u32>;
// grid: the tiles a mode's list holds at most, the integration's reduction.
@compute @workgroup_size(${WORKGROUP}) fn debugTileQuads(@builtin(global_invocation_id) id:vec3u){
 let mode=id.y;
 if(id.x>=tileCounts[${INTEGRATE_TILE_COUNTS_AT}u+mode]){return;}
 let tile=tileList[mode*tiles.grid.x+id.x];
 let side=f32(${INTEGRATE_TILE_SIDE}u*tiles.grid.y);
 let lo=vec2f(f32(tile&0xffffu),f32(tile>>16u))*side*tiles.scale.xy;
 let colors=array<u32,${INTEGRATE_TILE_MODE_COUNT}>(${COLORS.join(',')});
 gpuLineFilled(lo,lo+side*tiles.scale.xy,colors[mode]);
}`,
  [gpuLineSink(3, 4)],
)

const kernel = autoKernel('Trillion3D debug integration tiles', tileQuadsWgsl, 'debugTileQuads')
const words = new ArrayBuffer(32)
const uints = new Uint32Array(words)
const floats = new Float32Array(words)

/** Appends the tiles of the lists `resources` hold for an image of `geometry` whose integration runs at the reduction `downsample`, seen at a display of `size` pixels. */
export function encodeTileQuads(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lines: GpuLines,
  resources: ScreenProbeResources,
  geometry: ScreenProbeGeometry,
  downsample: number,
  size: readonly [number, number],
) {
  const tiles = integrateTiles(geometry, downsample)
  uints.set([tiles, downsample])
  floats.set([size[0] / geometry.width, size[1] / geometry.height], 4)
  lines.run(
    encoder,
    kernel(device),
    [
      { buffer: lines.uniform('tiles', words) },
      { buffer: resources.tileList },
      { buffer: resources.tileArgs },
      { buffer: lines.lines },
      { buffer: lines.count },
    ],
    ceilDiv(tiles, WORKGROUP),
    INTEGRATE_TILE_MODE_COUNT,
  )
}
