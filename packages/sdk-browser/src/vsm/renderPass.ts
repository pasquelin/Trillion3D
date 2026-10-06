/**
 * Step 5: the non-cluster shadow map render on the engine's resident cluster rows — the caster cull
 * and the raster into the physical pool (`renderCullWgsl.ts`, `renderRasterWgsl.ts`). Called
 * between `encodeVsmPageMapping` and `encodeVsmAfterRaster`, before `swapFrames`: it reads
 * `res.current` (page table, flags, receiver covers, uncached rects, projection data) and writes
 * `res.pagePool` and `res.rasterMarks`.
 *
 * Every page allocated and valid for rendering this frame is drawn this frame. The work list of the
 * raster is (row, page) pairs; its worst case is rows × PoolPages (a row can touch at most
 * every valid-for-rendering page once, each physical page backs one virtual page). Rows are
 * processed in chunks of K = pairCapacity / PoolPages candidates, as many chunks as the
 * row count needs, each sized for its own worst case — commands ≤ K · min(view mips, pages), pairs
 * ≤ K · pages — so no list can overflow and nothing waits for a later frame. The command bound is
 * exact: a row makes at most one command per (map, mip) — one per mip of each map view — and
 * only where its uncached rect overlaps a page flagged in that (map, mip): an allocated page of
 * it (a single-page map holds its one page at the last mip, the only rect its maps' bounds give
 * it), and each physical page backs one (map, mip).
 *
 * The camera's cut chooses the candidates on the GPU: the CPU knows no bound of them below the row
 * count, so it encodes the chunks that count needs. A chunk past the candidates culls, expands and
 * draws nothing — its cull, expand and draw read their arguments from the one argument buffer:
 * no group, no instance —; its two argument kernels run a thread each, and its raster pass clears
 * a page of dummy depth it discards (cleared on chip on a tiled GPU, where a read-only depth
 * would be loaded).
 *
 * Order (one frame per submit: parameters go through `queue.writeBuffer`):
 *   clear counters → vsmRenderCandidates (rows) → vsmRenderArgsCull
 *   per chunk: vsmRenderCull (indirect) → vsmRenderArgsExpand → vsmRenderExpand (indirect)
 *              → vsmRenderArgsDraw → raster pass, one drawIndirect into a 128×128 dummy target.
 */
import { writeSplitDouble } from '../../../sdk-core/src/math/primitives/splitDouble.ts';
import { preparedPipeline, type PreparedPipeline } from '../lighting/deferred/fullscreen.ts';
import { dispatchGrid } from '../gpu/dag/shader/gridWgsl.ts';
import {
  VSM_MIPS,
  VSM_PAGE_TEXELS,
  VSM_RENDER_CANDIDATE_BYTES,
  VSM_RENDER_CMD_BYTES,
  VSM_RENDER_PAIR_BYTES,
  VSM_RENDER_PAIR_CAPACITY,
} from './constants.ts';
import {
  vsmBufferEntry,
  vsmComputePipe,
  vsmDynamicUniformEntry,
  type VsmComputePipe,
} from './passKit.ts';
import { ledgerRoom } from '../gpu/core/deviceLedger.ts';
import { madeTextureBytes, textureBytesOf } from '../gpu/core/textureBytes.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts';
import { vsmWriteChanged } from './writeChanged.ts';
import {
  createVsmRowBound,
  vsmBoundChunk,
  vsmWorstChunk,
  type VsmBoundLight,
  type VsmChunk,
  type VsmRowBound,
  type VsmRowSpheres,
  type VsmWorst,
} from './rowPageBound.ts';
import {
  VSM_RENDER_ARGS_CULL,
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_EXPAND,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_ARGS_WGSL,
  VSM_RENDER_COUNTS_HEAD,
  VSM_RENDER_CULL_SPECS,
  VSM_RENDER_EXPAND_SPECS,
  VSM_RENDER_GROUP,
  VSM_RENDER_PARAMS_SLOT,
  VSM_RENDER_VIEW_DIRECTIONAL,
  vsmRenderCandidatesWgsl,
  vsmRenderCullWgsl,
  vsmRenderExpandWgsl,
} from './renderCullWgsl.ts';
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
  VSM_RENDER_TARGET_FORMAT,
  vsmRenderRasterWgsl,
} from './renderRasterWgsl.ts';
import {
  type VsmFrameBuffers,
  type VsmResources,
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmPerFrameSet,
} from './resources.ts';
import { ceilDiv, roundUpPow2, type VsmLayout } from './layout.ts';

/** The main view whose level of detail the casters take (the level of detail the main view draws). */
interface VsmRenderCamera {
  /** World eye position (double precision; split high/low on upload). */
  eye: ArrayLike<number>;
  /** World-to-view matrix, column-major, engine convention (−Z forward). */
  view: ArrayLike<number>;
  /** Pixels per unit at unit depth (perspective) or per unit (ortho): max(P00·w/2, P11·h/2). */
  focalPixels: number;
  near: number;
  perspective: boolean;
  /** The camera cut's pixel error threshold. */
  threshold: number;
}

/**
 * The engine's caster rows. `pageTable`, `spheres`, `mobility`, `rowLods` are the buffers of
 * `vis.pageTable`, `lights.spheres.buffer`, `lights.mobilityRows`, `lights.rowLods.buffer`;
 * `pageLayout` / `pageGroup` the shadow page group (`shadows.freshDraws.pageLayout`,
 * `shadowPageGroup(rt, device)`), group 0 of the raster.
 */
export interface VsmRenderScene {
  /** Rows of the page table to consider (`layout.rows.packedCount`; the blended rows after it are skipped). */
  rowCount: number;
  pageTable: GPUBuffer;
  spheres: GPUBuffer;
  mobility: GPUBuffer;
  rowLods: GPUBuffer;
  pageLayout: GPUBindGroupLayout;
  pageGroup: GPUBindGroup;
  camera: VsmRenderCamera;
  /** The CPU copy of `spheres` (`lights.spheres`): chunks are sized by where the rows are
   *  (`rowPageBound.ts`), or, where that cannot speak, by the worst case: every row reaching every
   *  page. */
  rowSpheres: VsmRowSpheres;
}

/** Declared: a caster whose radius is under a hundredth of its distance from the eye (0.57°, about
 *  5 pixels of radius in a 1 080-pixel, 90° view) is not drawn into an uncached map; squared, as the
 *  cull compares squares. Larger drops more small casters from fresh maps; 0 keeps them all. */
const VSM_SMALL_CASTER_SQ = 0.01 * 0.01;

export interface VsmRenderFrame {
  device: GPUDevice;
  /** This frame's lights (`VsmFramePlan.lights`); only `shouldRender` ones are drawn. */
  lights: readonly VsmBoundLight[];
}

/** What one call encoded, for diagnostics. */
export interface VsmRenderStats {
  chunks: number;
  chunkRows: number;
  /** The GPU budget's room held fewer rows a chunk than asked (`vsmChunkRowsWithin`): the same
   *  pages in more passes — none at all when `chunks` is 0, the raster skipped. */
  roomLimited: boolean;
}

/** Bytes of the parameters a kernel binds from its chunk's slot (`VsmRenderParams`). */
const VSM_RENDER_PARAMS_BYTES = 128;
/** Usage of the lists the kernels fill. */
export const vsmRenderStorage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

/** The cull, expand and argument kernels of a raster over caster rows (`renderCullWgsl.ts`):
 *  the opaque raster's, and the transmission atlas's with its own cull. */
export interface VsmChunkKernels {
  cull: VsmComputePipe;
  expand: VsmComputePipe;
  /** One source, one group layout: each pipe's `groups[0]` is the same entries. */
  args: { cull: VsmComputePipe; expand: VsmComputePipe; draw: VsmComputePipe };
}

interface Ctx extends VsmChunkKernels {
  device: GPUDevice;
  layout: VsmLayout;
  pageLayout: GPUBindGroupLayout;
  candidates: VsmComputePipe;
  raster: {
    readonly pipeline: GPURenderPipeline;
    layout1: GPUBindGroupLayout;
    prepared: PreparedPipeline<GPURenderPipeline>;
  };
  target: GPUTextureView;
  targetTexture: GPUTexture;
  buffers: Partial<Record<VsmListName, GPUBuffer>>;
  /** The scene's rows and the lists the groups bound when made (`renderGroups`). */
  bound: WebgpuBindIdentity;
  /** The groups over the scene's rows and the lists alone, made again when one of them moved. */
  groups?: ReturnType<typeof vsmChunkListGroups>;
  /** The groups over the tables of a frame set (`res.current`, the two in turn), made once a set
   *  and again when the lists moved. */
  tables: WeakMap<VsmFrameBuffers, RasterTables>;
  /** Where the rows are, binned for the chunks' bound. */
  rowBound: VsmRowBound;
}

const contexts = new WeakMap<VsmResources, Ctx>();

/** The parameters' binding: the chunk's slot, by dynamic offset. */
export const vsmRenderParamsEntry = (binding: number) =>
  vsmDynamicUniformEntry(binding, VSM_RENDER_PARAMS_BYTES);

/** The cull (`cullCode`), expand and argument kernels, labelled under `label`: pipes made once a
 *  device and source (`vsmComputePipe`), so a pass whose kernel is another's shares its pipe — the
 *  raster's and the transmission's expand and arguments are one — and their groups' layouts. Each
 *  pipeline is read from its pipe where it is bound. */
export function vsmChunkKernels(
  device: GPUDevice,
  layout: VsmLayout,
  label: string,
  cullCode: string,
): VsmChunkKernels {
  const C = GPUShaderStage.COMPUTE;
  const P = vsmRenderParamsEntry;
  const pipe = (
    name: string,
    code: string,
    entryPoint: string,
    groups: GPUBindGroupLayoutEntry[][],
  ) => vsmComputePipe(device, `${label}.${name}`, code, entryPoint, groups);
  const cull = pipe('cull', cullCode, 'vsmRenderCull', [
    vsmBindGroupLayoutEntries(VSM_RENDER_CULL_SPECS, layout, C),
    [
      P(0),
      vsmBufferEntry(1, C, 'read-only-storage'),
      vsmBufferEntry(2, C, 'read-only-storage'),
      vsmBufferEntry(3, C, 'storage'),
      vsmBufferEntry(4, C, 'storage'),
    ],
  ]);
  const expand = pipe('expand', vsmRenderExpandWgsl(layout), 'vsmRenderExpand', [
    vsmBindGroupLayoutEntries(VSM_RENDER_EXPAND_SPECS, layout, C),
    [
      P(0),
      vsmBufferEntry(1, C, 'read-only-storage'),
      vsmBufferEntry(2, C, 'storage'),
      vsmBufferEntry(3, C, 'storage'),
    ],
  ]);
  const argsEntries = [P(0), vsmBufferEntry(1, C, 'storage'), vsmBufferEntry(2, C, 'storage')];
  const args = (entryPoint: string) =>
    pipe('args', VSM_RENDER_ARGS_WGSL, entryPoint, [argsEntries]);
  return {
    cull,
    expand,
    args: {
      cull: args('vsmRenderArgsCull'),
      expand: args('vsmRenderArgsExpand'),
      draw: args('vsmRenderArgsDraw'),
    },
  };
}

/** The raster's compute pipes of `layout` (`vsmComputePipe`): its candidates and chunk kernels. */
export function vsmRenderComputePipes(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE;
  const candidates = vsmComputePipe(
    device,
    'vsm.render.candidates',
    vsmRenderCandidatesWgsl(),
    'vsmRenderCandidates',
    [
      [
        vsmRenderParamsEntry(0),
        ...[1, 2, 3, 4].map((b) => vsmBufferEntry(b, C, 'read-only-storage')),
        vsmBufferEntry(5, C, 'storage'),
        vsmBufferEntry(6, C, 'storage'),
      ],
    ],
  );
  return {
    candidates,
    ...vsmChunkKernels(device, layout, 'vsm.render', vsmRenderCullWgsl(layout)),
  };
}

/** Each device's raster pipelines, by the shadow page group's layout and the raster's text. */
const RASTERS = new WeakMap<GPUDevice, WeakMap<GPUBindGroupLayout, Map<string, Ctx['raster']>>>();

/**
 * The raster's render pipeline for `layout` on the shadow page group `pageLayout`
 * (`webgpu/shadow/pageGroup.ts`, made at load) and its group 1's layout: described once a device,
 * page layout and raster text, compiled the engine's one way (`preparedPipeline`) — by the prepare
 * step for the set the casting lights are first granted (`prepareVsmPipelines`), at once by a frame
 * that binds it unprepared. `pipeline` is read where it is bound.
 */
export function vsmRasterPipe(
  device: GPUDevice,
  layout: VsmLayout,
  pageLayout: GPUBindGroupLayout,
): Ctx['raster'] {
  let byPage = RASTERS.get(device);
  if (!byPage) RASTERS.set(device, (byPage = new WeakMap()));
  let byCode = byPage.get(pageLayout);
  if (!byCode) byPage.set(pageLayout, (byCode = new Map()));
  const code = vsmRenderRasterWgsl(layout);
  const held = byCode.get(code);
  if (held) return held;
  const layout1 = device.createBindGroupLayout({
    label: 'vsm.render.raster1',
    entries: [
      vsmBufferEntry(0, GPUShaderStage.VERTEX, 'read-only-storage'),
      ...vsmBindGroupLayoutEntries(VSM_RENDER_RASTER_VERTEX_SPECS, layout, GPUShaderStage.VERTEX),
      ...vsmBindGroupLayoutEntries(
        VSM_RENDER_RASTER_FRAGMENT_SPECS,
        layout,
        GPUShaderStage.FRAGMENT,
      ),
    ],
  });
  const module = device.createShaderModule({ label: 'vsm.render.raster', code });
  const prepared = preparedPipeline(device, {
    label: 'vsm.render.raster',
    layout: device.createPipelineLayout({ bindGroupLayouts: [pageLayout, layout1] }),
    vertex: { module, entryPoint: 'vsmRenderVs' },
    fragment: { module, entryPoint: 'vsmRenderFs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: VSM_RENDER_TARGET_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'always',
    },
  });
  const raster = {
    layout1,
    prepared,
    get pipeline() {
      return prepared.get();
    },
  };
  byCode.set(code, raster);
  return raster;
}

function context(res: VsmResources, device: GPUDevice, pageLayout: GPUBindGroupLayout): Ctx {
  const existing = contexts.get(res);
  if (
    existing &&
    existing.device === device &&
    existing.layout === res.layout &&
    existing.pageLayout === pageLayout
  )
    return existing;
  const layout = res.layout;
  // A context made again for the same device keeps its lists; its old target is freed.
  if (existing?.device === device) existing.targetTexture.destroy();
  const targetTexture = device.createTexture(renderTarget());

  const ctx: Ctx = {
    device,
    layout,
    pageLayout,
    ...vsmRenderComputePipes(device, layout),
    raster: vsmRasterPipe(device, layout, pageLayout),
    target: targetTexture.createView(),
    targetTexture,
    buffers: existing?.device === device ? existing.buffers : {},
    bound: createWebgpuBindIdentity(),
    tables: new WeakMap(),
    rowBound: existing?.rowBound ?? createVsmRowBound(),
  };
  contexts.set(res, ctx);
  return ctx;
}

/** Frees what a draw context holds on the device: its lists and its dummy target. */
export function vsmReleaseContext(ctx: {
  buffers: Partial<Record<string, GPUBuffer>>;
  targetTexture?: GPUTexture;
}) {
  for (const buffer of Object.values(ctx.buffers)) buffer?.destroy();
  ctx.targetTexture?.destroy();
}

/** Frees the raster's context of `res`, with the set it was made for (`destroyEngineVsm`). */
export function releaseVsmRender(res: VsmResources) {
  const ctx = contexts.get(res);
  if (ctx) vsmReleaseContext(ctx);
  contexts.delete(res);
}

/** Bytes the raster's context of `res` holds on the device: its lists and its dummy target. */
export function vsmRenderContextBytes(res: VsmResources) {
  const ctx = contexts.get(res);
  return ctx ? vsmContextBytes(ctx) : 0;
}

/** Bytes a draw context holds on the device: its lists and its dummy target, if any. */
export function vsmContextBytes(ctx: {
  buffers: Partial<Record<string, GPUBuffer>>;
  targetTexture?: GPUTexture;
}) {
  let bytes = ctx.targetTexture ? madeTextureBytes(ctx.targetTexture) : 0;
  for (const buffer of Object.values(ctx.buffers)) bytes += buffer?.size ?? 0;
  return bytes;
}

/** Bytes `vsmEnsureBuffer` makes for `size`: a power of two, 256 at least. */
function ensuredBytes(size: number, minBytes = 256) {
  return Math.max(minBytes, roundUpPow2(size));
}

/** Bytes the device is asked for when `buffers` grow to `sizes` (`vsmEnsureBuffer`): each one
 *  short of its size made anew, the one it held freed first. */
function growthBytes(buffers: Partial<Record<string, GPUBuffer>>, sizes: Record<string, number>) {
  let total = 0;
  for (const name in sizes) {
    const held = buffers[name],
      size = sizes[name];
    if (!held || held.size < size) total += ensuredBytes(size) - (held?.size ?? 0);
  }
  return total;
}

/** The lists a chunk of `rows` rows takes, by buffer, when `chunked` rows are drawn in chunks
 *  over `candidates` candidate rows, `viewWords` words of views, a chunk holding `holds`. */
export function vsmChunkListSizes(
  rows: number,
  chunked: number,
  candidates: number,
  viewWords: number,
  holds: Omit<VsmChunk, 'rows'>,
) {
  const chunks = ceilDiv(chunked, rows);
  return {
    params: chunks * VSM_RENDER_PARAMS_SLOT,
    views: viewWords * 4,
    candidates: candidates * VSM_RENDER_CANDIDATE_BYTES,
    counts: (VSM_RENDER_COUNTS_HEAD + chunks * 4) * 4,
    cmds: holds.cmds(rows) * VSM_RENDER_CMD_BYTES,
    pairs: holds.pairs(rows) * VSM_RENDER_PAIR_BYTES,
    args: chunks * VSM_RENDER_ARGS_STRIDE_WORDS * 4,
  };
}

/**
 * The chunk of the rows `[first, end)`: by where they are (`vsmBoundChunk`), or, when the bound
 * cannot speak, the worst case.
 */
export function vsmChunkRows(
  bound: VsmRowBound,
  spheres: VsmRowSpheres,
  range: { first: number; end: number; candidates: number },
  lights: readonly VsmBoundLight[],
  worst: VsmWorst,
): VsmChunk {
  return (
    vsmBoundChunk(bound, spheres, range, lights, worst) ||
    vsmWorstChunk(worst.rows, worst.cmdsPerRow, worst.pages)
  );
}

/**
 * The most rows a chunk takes, `rows` then its halves down to one, whose lists (`sizes` of a
 * chunk of that many rows) grow within the room the device ledger still admits, and those lists;
 * 0 rows when not even one row's do. A chunk of fewer rows draws the same pages — the raster's
 * depth is an atomic max, whatever the order — in more passes, and asks no allocation the
 * budget refuses. Lists that need not grow ask nothing of the ledger.
 */
export function vsmChunkRowsWithin<S extends Record<string, number>>(
  device: GPUDevice,
  buffers: Partial<Record<string, GPUBuffer>>,
  rows: number,
  sizes: (rows: number) => S,
): { rows: number; size?: S; limited: boolean } {
  const whole = sizes(rows);
  if (growthBytes(buffers, whole) === 0) return { rows, size: whole, limited: false };
  const room = ledgerRoom(device);
  for (let r = rows; ; r = ceilDiv(r, 2)) {
    const size = r === rows ? whole : sizes(r);
    if (growthBytes(buffers, size) <= room) return { rows: r, size, limited: r < rows };
    if (r === 1) return { rows: 0, limited: true };
  }
}

/** The fewest bytes lists of `sizes` take, over the chunk sizes `vsmChunkRowsWithin` tries from
 *  `rows`: fewer rows take smaller lists of pairs, more chunks larger lists of parameters. */
export function vsmDrawFloorBytes(rows: number, sizes: (rows: number) => Record<string, number>) {
  let least = Infinity;
  for (let r = rows; ; r = ceilDiv(r, 2)) {
    least = Math.min(least, growthBytes({}, sizes(r)));
    if (r === 1) return least;
  }
}

type VsmListName = 'params' | 'views' | 'candidates' | 'counts' | 'cmds' | 'pairs' | 'args';

/** A buffer of at least `size` bytes under `name` in `ctx.buffers` (labelled `label.name`),
 *  regrown by powers of two. */
export function vsmEnsureBuffer<K extends string>(
  ctx: { device: GPUDevice; buffers: Partial<Record<K, GPUBuffer>> },
  label: string,
  name: K,
  size: number,
  usage: GPUBufferUsageFlags,
  minBytes = 256,
) {
  const held = ctx.buffers[name];
  if (held && held.size >= size) return held;
  held?.destroy();
  const made = ctx.device.createBuffer({
    label: `${label}.${name}`,
    size: ensuredBytes(size, minBytes),
    usage,
  });
  ctx.buffers[name] = made;
  return made;
}

/**
 * Map views, as `vec4u` (VSM id, mips, flags, 0): one per clipmap level (1
 * mip, clamp to near plane), one per local light face / map (8 mip views); and
 * the mip views they hold in all.
 */
export function vsmRenderViews(lights: VsmRenderFrame['lights'], views: number[] = []) {
  views.length = 0;
  let viewMips = 0;
  for (const light of lights) {
    if (!light.shouldRender) continue;
    const directional = light.kind === 'directional';
    for (let k = 0; k < light.count; k++) {
      const mips = directional ? 1 : VSM_MIPS;
      views.push(light.firstId + k, mips, directional ? VSM_RENDER_VIEW_DIRECTIONAL : 0, 0);
      viewMips += mips;
    }
  }
  return { views, viewMips };
}

/** What sizes the chunks of a raster over caster rows. */
interface VsmRenderChunking {
  rowCount: number;
  viewCount: number;
  chunks: number;
  chunkRows: number;
  cmdCapacity: number;
  pairCapacity: number;
}

/** An image of parameter slots, its words seen as floats and as integers. */
interface VsmRenderParamsImage {
  f: Float32Array<ArrayBuffer>;
  u: Uint32Array<ArrayBuffer>;
}
const eye = new Float32Array(8);

/** The parameter slots of `chunking.chunks` chunks (`VsmRenderParams`): the frame's values in
 *  every slot, the chunk's own index and range — into `image` (its words past the slots' 32 left
 *  as they are: zero, as nothing else writes them). */
function vsmRenderParams(
  camera: VsmRenderCamera,
  chunking: VsmRenderChunking,
  image: VsmRenderParamsImage,
) {
  const { chunks, chunkRows } = chunking;
  const slotWords = VSM_RENDER_PARAMS_SLOT / 4;
  const { f, u } = image;
  for (let a = 0; a < 3; a++) writeSplitDouble(eye, a, 4 + a, camera.eye[a]);
  for (let c = 0; c < chunks; c++) {
    const o = c * slotWords;
    for (let a = 0; a < 3; a++) {
      f[o + a] = eye[a];
      f[o + 4 + a] = eye[4 + a];
    }
    f[o + 3] = camera.perspective ? 1 : 0;
    f[o + 7] = camera.focalPixels;
    // World-to-view rotation rows (column-major m[c*4+r]).
    for (let r = 0; r < 3; r++) {
      f[o + 8 + r * 4] = camera.view[r];
      f[o + 9 + r * 4] = camera.view[4 + r];
      f[o + 10 + r * 4] = camera.view[8 + r];
      f[o + 11 + r * 4] = 0;
    }
    f[o + 20] = camera.near;
    f[o + 21] = camera.threshold;
    f[o + 22] = VSM_SMALL_CASTER_SQ;
    u[o + 23] = chunking.rowCount;
    u[o + 24] = chunking.viewCount;
    u[o + 25] = c;
    u[o + 26] = c * chunkRows;
    u[o + 27] = chunkRows;
    u[o + 28] = chunks;
    u[o + 29] = chunking.cmdCapacity;
    u[o + 30] = chunking.pairCapacity;
    u[o + 31] = 1; // `pad`: unread, kept at its old value (`planUploads.test.ts` pins the bytes).
  }
}

/** The candidates kernel over `rowCount` rows, then the cull dispatch of every chunk, in `pass`:
 *  the opaque raster's and the transmission's. */
export function encodeVsmCandidates(
  pass: GPUComputePassEncoder,
  candidates: GPUComputePipeline,
  candGroup: GPUBindGroup,
  kernels: VsmChunkKernels,
  argsGroup: GPUBindGroup,
  rowCount: number,
) {
  pass.setPipeline(candidates);
  pass.setBindGroup(0, candGroup, [0]);
  pass.dispatchWorkgroups(...dispatchGrid(ceilDiv(rowCount, VSM_RENDER_GROUP)));
  pass.setPipeline(kernels.args.cull.pipeline);
  pass.setBindGroup(0, argsGroup, [0]);
  pass.dispatchWorkgroups(1);
}

/** The bind groups of one chunk's cull and expand: `cull0` / `expand0` the VSM tables', the
 *  others at the chunk's dynamic offset. */
export interface VsmChunkGroups {
  cull0: GPUBindGroup;
  cull1: GPUBindGroup;
  expand0: GPUBindGroup;
  expand1: GPUBindGroup;
  args: GPUBindGroup;
}

/** Chunk `c`'s cull, then the expand's indirect arguments (one group per command), in `pass`: what
 *  the raster expands into pairs and the transmission bins. The cull reads its arguments from
 *  `args`, no group for a chunk with no candidate; the argument kernel runs one thread, directly:
 *  it writes `args`, bound as storage, and a dispatch may not read its arguments from a buffer it
 *  binds writable (one usage scope). */
export function encodeVsmChunkCommands(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels,
  groups: Pick<VsmChunkGroups, 'cull0' | 'cull1' | 'args'>,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
) {
  pass.setPipeline(kernels.cull.pipeline);
  pass.setBindGroup(0, groups.cull0);
  pass.setBindGroup(1, groups.cull1, offset);
  pass.dispatchWorkgroupsIndirect(
    args,
    c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_CULL * 4,
  );
  pass.setPipeline(kernels.args.expand.pipeline);
  pass.setBindGroup(0, groups.args, offset);
  pass.dispatchWorkgroups(1);
}

/** Chunk `c`'s commands (`encodeVsmChunkCommands`), then its expand (marking jobs and the raster's
 *  pages) and the draw's arguments, in `pass`. */
function encodeVsmChunkCull(
  pass: GPUComputePassEncoder,
  kernels: VsmChunkKernels,
  groups: VsmChunkGroups,
  args: GPUBuffer,
  c: number,
  offset: readonly number[],
) {
  encodeVsmChunkCommands(pass, kernels, groups, args, c, offset);
  pass.setPipeline(kernels.expand.pipeline);
  pass.setBindGroup(0, groups.expand0);
  pass.setBindGroup(1, groups.expand1, offset);
  pass.dispatchWorkgroupsIndirect(
    args,
    c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_EXPAND * 4,
  );
  pass.setPipeline(kernels.args.draw.pipeline);
  pass.setBindGroup(0, groups.args, offset);
  pass.dispatchWorkgroups(1);
}

/** Chunk `c`'s raster: one drawIndirect of its pairs into the page-sized dummy `target`. */
function encodeVsmChunkRaster(
  encoder: GPUCommandEncoder,
  label: string,
  pipeline: GPURenderPipeline,
  target: GPUTextureView,
  pageGroup: GPUBindGroup,
  raster1: GPUBindGroup,
  args: GPUBuffer,
  c: number,
) {
  const raster = encoder.beginRenderPass({
    label,
    colorAttachments: [],
    depthStencilAttachment: {
      view: target,
      depthClearValue: 0,
      depthLoadOp: 'clear',
      depthStoreOp: 'discard',
    },
  });
  raster.setPipeline(pipeline);
  raster.setBindGroup(0, pageGroup);
  raster.setBindGroup(1, raster1);
  raster.drawIndirect(args, c * VSM_RENDER_ARGS_STRIDE_WORDS * 4 + VSM_RENDER_ARGS_DRAW * 4);
  raster.end();
}

/** Rows a chunk of the raster asks for `rowCount` rows in the worst case: pairs ≤ K ·
 *  PoolPages, commands ≤ K · min(view mips, PoolPages), each list within one
 *  binding (`cap` entries). */
function renderChunking(
  limits: GPUSupportedLimits,
  pages: number,
  viewMips: number,
  rowCount: number,
) {
  const maxBinding = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize);
  const pairs = Math.max(
    pages,
    Math.min(VSM_RENDER_PAIR_CAPACITY, Math.floor(maxBinding / VSM_RENDER_PAIR_BYTES)),
  );
  const cmdsPerRow = Math.min(viewMips, pages);
  let rows = Math.max(1, Math.floor(pairs / pages));
  rows = Math.min(rows, Math.max(1, Math.floor(maxBinding / VSM_RENDER_CMD_BYTES / cmdsPerRow)));
  return { rows: Math.min(rows, rowCount), cmdsPerRow, cap: pairs };
}

/** The raster's lists for a chunk of `rows` rows, by buffer. */
const renderSizes = (rowCount: number, viewWords: number, holds: VsmChunk) => (rows: number) =>
  vsmChunkListSizes(rows, rowCount, rowCount, viewWords, holds);

/** The raster's dummy target (`context`): one page of depth. */
const renderTarget = () => ({
  label: 'vsm.render.dummyTarget',
  size: [VSM_PAGE_TEXELS, VSM_PAGE_TEXELS],
  format: VSM_RENDER_TARGET_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

/**
 * The fewest bytes the raster's context of a set at `pages` pages takes to draw `rowCount` rows
 * under views of `viewWords` words and `viewMips` mips: its dummy target and its lists at the
 * chunk size, among those `vsmChunkRowsWithin` tries, that takes the least. Set aside beside a new
 * set (`vsmGrant.ts`): the raster then always finds room for one chunk.
 */
export function vsmRenderFloorBytes(
  limits: GPUSupportedLimits,
  rowCount: number,
  viewWords: number,
  viewMips: number,
  pages: number,
) {
  if (rowCount <= 0 || viewWords <= 0) return 0;
  const { rows, cmdsPerRow } = renderChunking(limits, pages, viewMips, rowCount);
  const target = textureBytesOf(renderTarget())!;
  return (
    target +
    vsmDrawFloorBytes(
      rows,
      renderSizes(rowCount, viewWords, vsmWorstChunk(rows, cmdsPerRow, pages)),
    )
  );
}

// The frame's scratch of the raster and the transmission's draw (one after the other, never
// nested): their views, parameter slots and chunking, rewritten each frame (what reaches a buffer
// is what `vsmWriteChanged` holds for it, per buffer).
const viewList: number[] = [];
let viewWords = new Uint32Array(0);
const paramsImage: VsmRenderParamsImage = {
  f: new Float32Array(0),
  u: new Uint32Array(0),
};
/** What sizes this frame's chunks: `vsmSetChunking` sets it, `vsmWriteChunkParams` sends it. */
const vsmChunking: VsmRenderChunking = {
  rowCount: 0,
  viewCount: 0,
  chunks: 0,
  chunkRows: 0,
  cmdCapacity: 0,
  pairCapacity: 0,
};

/** The seven lists of a chunked raster under `label`, grown to `size` (`vsmChunkListSizes`): the
 *  buffers its parameters, its views, its counters and its arguments are written or cleared in. */
export function vsmEnsureLists(
  ctx: { device: GPUDevice; buffers: Partial<Record<VsmListName, GPUBuffer>> },
  label: string,
  size: ReturnType<typeof vsmChunkListSizes>,
) {
  const storage = vsmRenderStorage();
  const params = vsmEnsureBuffer(
    ctx,
    label,
    'params',
    size.params,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const views = vsmEnsureBuffer(ctx, label, 'views', size.views, storage);
  vsmEnsureBuffer(ctx, label, 'candidates', size.candidates, storage);
  const counts = vsmEnsureBuffer(ctx, label, 'counts', size.counts, storage);
  vsmEnsureBuffer(ctx, label, 'cmds', size.cmds, storage);
  vsmEnsureBuffer(ctx, label, 'pairs', size.pairs, storage);
  const args = vsmEnsureBuffer(ctx, label, 'args', size.args, storage | GPUBufferUsage.INDIRECT);
  return { params, views, counts, args };
}

/** Sets `vsmChunking`: `chunks` chunks of `chunkRows` rows over `rowCount` rows and `viewCount`
 *  views, the lists as big as `chosen` holds. */
export function vsmSetChunking(
  counts: Pick<VsmRenderChunking, 'rowCount' | 'viewCount' | 'chunks' | 'chunkRows'>,
  chosen: VsmChunk,
) {
  Object.assign(vsmChunking, counts);
  vsmChunking.cmdCapacity = chosen.cmds(counts.chunkRows);
  vsmChunking.pairCapacity = chosen.pairs(counts.chunkRows);
}

/** The pass labels of a chunked raster under `prefix`, and chunk `c`'s parameter offset: made once
 *  for every frame. */
function vsmChunkPasses(prefix: string) {
  const held: { cullPass: GPUComputePassDescriptor; raster: string; offset: number[] }[] = [];
  return {
    candidatesPass: { label: `${prefix}.candidates` },
    chunk: (c: number) =>
      (held[c] ??= {
        cullPass: { label: `${prefix}.cull ${c}` },
        raster: `${prefix}.raster ${c}`,
        offset: [c * VSM_RENDER_PARAMS_SLOT],
      }),
  };
}

/**
 * The candidates' kernel over `rowCount` rows, then, for each of `chunks`, its compute pass (the
 * cull and the expand) and its raster pass.
 */
function vsmEncodeChunks(
  encoder: GPUCommandEncoder,
  ctx: VsmChunkKernels & {
    candidates: { pipeline: GPUComputePipeline };
    raster: { pipeline: GPURenderPipeline };
    target: GPUTextureView;
  },
  passes: ReturnType<typeof vsmChunkPasses>,
  groups: { cand: GPUBindGroup; chunk: VsmChunkGroups; raster1: GPUBindGroup },
  pageGroup: GPUBindGroup,
  args: GPUBuffer,
  rowCount: number,
  chunks: number,
) {
  const first = encoder.beginComputePass(passes.candidatesPass);
  encodeVsmCandidates(
    first,
    ctx.candidates.pipeline,
    groups.cand,
    ctx,
    groups.chunk.args,
    rowCount,
  );
  first.end();
  for (let c = 0; c < chunks; c++) {
    const each = passes.chunk(c);
    const pass = encoder.beginComputePass(each.cullPass);
    encodeVsmChunkCull(pass, ctx, groups.chunk, args, c, each.offset);
    pass.end();
    // The non-cluster raster: one page viewport, atomicMax into the pool.
    encodeVsmChunkRaster(
      encoder,
      each.raster,
      ctx.raster.pipeline,
      ctx.target,
      pageGroup,
      groups.raster1,
      args,
      c,
    );
  }
}

/** The parameter slots of `vsmChunking` and the views `views` up to their buffers: where they
 *  changed alone (`vsmWriteChanged`). */
export function vsmWriteChunkParams(
  device: GPUDevice,
  camera: VsmRenderCamera,
  paramsBuffer: GPUBuffer,
  viewsBuffer: GPUBuffer,
  views: readonly number[],
) {
  const slotWords = (vsmChunking.chunks * VSM_RENDER_PARAMS_SLOT) / 4;
  vsmGrowParamsImage(paramsImage, slotWords);
  vsmRenderParams(camera, vsmChunking, paramsImage);
  vsmWriteChanged(device, paramsBuffer, paramsImage.u, 0, slotWords);
  if (viewWords.length < views.length)
    viewWords = new Uint32Array(ensuredBytes(views.length * 4) / 4);
  for (let k = 0; k < views.length; k++) viewWords[k] = views[k];
  vsmWriteChanged(device, viewsBuffer, viewWords, 0, views.length);
}

/**
 * Whether what a chunk pass's groups bind moved since they were made — the scene's rows and the
 * lists (the first 11 words of `identity`, the raster's and the transmission's draw's), then the
 * `extra` words of its own the pass wrote after them —: `identity` holds them after.
 */
export function vsmSceneRowsMoved(
  identity: WebgpuBindIdentity,
  scene: VsmRenderScene,
  b: Record<'params' | 'views' | 'candidates' | 'counts' | 'cmds' | 'pairs' | 'args', GPUBuffer>,
  extra = 0,
) {
  const bound = identity.next;
  bound[0] = scene.pageTable;
  bound[1] = scene.spheres;
  bound[2] = scene.mobility;
  bound[3] = scene.rowLods;
  bound[4] = b.params;
  bound[5] = b.views;
  bound[6] = b.candidates;
  bound[7] = b.counts;
  bound[8] = b.cmds;
  bound[9] = b.pairs;
  bound[10] = b.args;
  bound.length = 11 + extra;
  return identity.moved();
}

/** The groups of a chunk pass over the scene's rows and the lists `bound` names
 *  (`vsmSceneRowsMoved`): the candidates' — `extra` after its counts —, the cull's, the expand's
 *  and the arguments'; with the parameters' window and the lists the pass's own groups bind. */
export function vsmChunkListGroups(
  device: GPUDevice,
  kernels: VsmChunkKernels,
  candidatesLayout: GPUBindGroupLayout,
  bound: readonly unknown[],
  extra: readonly GPUBuffer[] = [],
) {
  const [
    pageTable,
    spheres,
    mobility,
    rowLods,
    paramsBuffer,
    views,
    candidates,
    counts,
    cmds,
    pairs,
    args,
  ] = bound as GPUBuffer[];
  const params = { buffer: paramsBuffer, size: VSM_RENDER_PARAMS_BYTES };
  const group = (layout: GPUBindGroupLayout, buffers: (GPUBuffer | typeof params)[]) =>
    vsmBufferGroup(device, layout, buffers);
  return {
    params,
    counts,
    pairs,
    cand: group(candidatesLayout, [
      ...[params, pageTable, spheres, mobility],
      ...[rowLods, candidates, counts, ...extra],
    ]),
    cull1: group(kernels.cull.groups[1], [params, views, candidates, counts, cmds]),
    expand1: group(kernels.expand.groups[1], [params, cmds, counts, pairs]),
    args: group(kernels.args.cull.groups[0], [params, counts, args]),
  };
}
const chunkPasses = vsmChunkPasses('vsm.render');

/** A bind group of whole buffers in binding order, but for the entries that name their own window
 *  (a `GPUBufferBinding`, the raster's parameters). No `instanceof GPUBuffer`: the interface is no
 *  global outside a WebGPU realm. */
export function vsmBufferGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: readonly (GPUBuffer | GPUBufferBinding)[],
) {
  return device.createBindGroup({
    layout,
    entries: resources.map((r, binding) => ({
      binding,
      resource: 'buffer' in r ? r : { buffer: r },
    })),
  });
}

/** `image` grown to hold `slotWords` words, the sizes `vsmEnsureBuffer` makes. */
function vsmGrowParamsImage(image: VsmRenderParamsImage, slotWords: number) {
  if (image.u.length >= slotWords) return;
  const raw = new ArrayBuffer(ensuredBytes(slotWords * 4));
  image.f = new Float32Array(raw);
  image.u = new Uint32Array(raw);
}

/** The raster's groups of a frame set (`renderGroups`): the candidates', the chunk groups and the
 *  raster's. */
interface RasterTables {
  cand: GPUBindGroup;
  chunk: VsmChunkGroups;
  raster1: GPUBindGroup;
}

/** The raster's groups over the tables of `res.current` and `ctx.groups` (`vsmPerFrameSet`). */
function rasterTables(res: VsmResources, ctx: Ctx): RasterTables {
  const { device } = ctx,
    groups = ctx.groups!;
  return {
    cand: groups.cand,
    chunk: {
      cull0: device.createBindGroup({
        layout: ctx.cull.groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_CULL_SPECS),
      }),
      cull1: groups.cull1,
      expand0: device.createBindGroup({
        layout: ctx.expand.groups[0],
        entries: vsmBindGroupEntries(res, VSM_RENDER_EXPAND_SPECS),
      }),
      expand1: groups.expand1,
      args: groups.args,
    },
    raster1: device.createBindGroup({
      layout: ctx.raster.layout1,
      entries: [
        { binding: 0, resource: { buffer: groups.pairs } },
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_VERTEX_SPECS),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_FRAGMENT_SPECS),
      ],
    }),
  };
}

/**
 * The raster's groups this frame: those over the scene's rows and the lists (`ctx.groups`) made
 * again only when one of them moved, those over the VSM tables once a frame set (`rasterTables`).
 */
function renderGroups(ctx: Ctx, res: VsmResources, scene: VsmRenderScene) {
  if (vsmSceneRowsMoved(ctx.bound, scene, ctx.buffers as Required<Ctx['buffers']>)) {
    ctx.groups = undefined;
    ctx.tables = new WeakMap();
  }
  ctx.groups ??= vsmChunkListGroups(ctx.device, ctx, ctx.candidates.groups[0], ctx.bound.next);
  return vsmPerFrameSet(ctx.tables, res, rasterTables, ctx);
}

/**
 * Renders the casters of this frame into the pages marked and allocated this frame
 * Nothing when no light renders or no row exists.
 */
export function encodeVsmRender(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmRenderFrame,
  scene: VsmRenderScene,
): VsmRenderStats | undefined {
  const { device } = frame;
  const { views, viewMips } = vsmRenderViews(frame.lights, viewList);
  const viewCount = views.length / 4;
  if (viewCount === 0 || scene.rowCount <= 0) return;

  const ctx = context(res, device, scene.pageLayout);
  const { layout } = res;
  const pages = layout.poolPages;
  const asked = renderChunking(device.limits, pages, viewMips, scene.rowCount);
  const chosen = vsmChunkRows(
    ctx.rowBound,
    scene.rowSpheres,
    { first: 0, end: scene.rowCount, candidates: scene.rowCount },
    frame.lights,
    { ...asked, pages },
  );
  const within = vsmChunkRowsWithin(
    device,
    ctx.buffers,
    chosen.rows,
    renderSizes(scene.rowCount, views.length, chosen),
  );
  const roomLimited = within.limited,
    size = within.size;
  const chunkRows = within.rows;
  if (!size) return { chunks: 0, chunkRows, roomLimited };
  const chunks = ceilDiv(scene.rowCount, chunkRows);

  const { params, views: viewsBuffer, counts, args } = vsmEnsureLists(ctx, 'vsm.render', size);
  vsmSetChunking({ rowCount: scene.rowCount, viewCount, chunks, chunkRows }, chosen);
  vsmWriteChunkParams(device, scene.camera, params, viewsBuffer, views);
  encoder.clearBuffer(counts, 0, size.counts);

  const tables = renderGroups(ctx, res, scene);
  vsmEncodeChunks(encoder, ctx, chunkPasses, tables, scene.pageGroup, args, scene.rowCount, chunks);
  return { chunks, chunkRows, roomLimited };
}
