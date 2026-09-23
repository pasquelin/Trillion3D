import { LIGHT_LIST_HEAD, NO_ROW, WORKGROUP, type DrawnLog } from './contract.ts';

/**
 * A light cut's drawn pages, turned into the page-table rows that hold them — what the light
 * compaction walks instead of every resident row.
 *
 * One map, catalogue page → row, lives on the card beside the draw records. It is kept by the rows
 * the table rewrites and by them alone (`mapRows`, over the range the camera's encode uploaded), so
 * a frame where no page arrives, leaves or moves touches none of it. A stale entry is never trusted:
 * the row it names must still be drawable and still carry that page, or the entry is dropped.
 *
 * `listHead` writes the list's count and group count, and the dispatch arguments the compaction
 * reads, from the light's own counter; `gatherRows` then resolves each drawn page, at its own rank
 * in the log. A light that draws nothing dispatches no gather and no compaction thread.
 */
const lightListShader = (
  slots: number,
) => `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}
struct Uniforms{rows:u32,first:u32,last:u32,logBase:u32,countWord:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@group(0) @binding(2) var<storage, read> drawn:array<u32>;
@group(0) @binding(3) var<storage, read> work:array<u32>;
@group(0) @binding(4) var<storage, read_write> rowOf:array<u32>;
@group(0) @binding(5) var<storage, read_write> list:array<u32>;
@group(0) @binding(6) var<storage, read_write> args:array<u32>;
@compute @workgroup_size(64)
fn mapRows(@builtin(global_invocation_id) id:vec3u){
 let row=uni.first+id.x;
 if(row>uni.last||row>=uni.rows){return;}
 rowOf[items[row].selectionIndex]=row;
}
@compute @workgroup_size(1)
fn listHead(){
 let n=work[uni.countWord];let groups=(n+63u)/64u;
 list[0]=n;list[1]=groups;
 args[0]=(groups*${slots}u+63u)/64u;args[1]=1u;args[2]=1u;
 args[3]=groups;args[4]=1u;args[5]=1u;
}
@compute @workgroup_size(64)
fn gatherRows(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=work[uni.countWord]){return;}
 let page=drawn[uni.logBase+s];
 let row=rowOf[page];
 var kept=${NO_ROW}u;
 if(row<uni.rows&&items[row].selectionIndex==page){kept=row;}
 list[${LIGHT_LIST_HEAD}u+s]=kept;
}
`;

/** `GPUShaderStage.COMPUTE`, written in the clear: this module is also read from Node. */
const COMPUTE = 4;

/** Byte offsets, in the list's argument buffer, of the count pass's and the scatter's dispatch. */
export const LIST_COUNT_ARGS = 0,
  LIST_SCATTER_ARGS = 12;

/**
 * The map, the row list and their argument buffers, for a catalogue of `pages` pages. Every
 * buffer is pushed onto `owned`, released with the draw that created them.
 */
export function createLightList(
  device: GPUDevice,
  itemsBuf: GPUBuffer,
  slots: number,
  pages: number,
  owned: GPUBuffer[],
) {
  const make = (size: number, usage: number) => {
    const buffer = device.createBuffer({ size: Math.max(16, size), usage });
    owned.push(buffer);
    return buffer;
  };
  const STORAGE = GPUBufferUsage.STORAGE;
  const rowOf = make(pages * 4, STORAGE);
  const list = make((LIGHT_LIST_HEAD + pages) * 4, STORAGE | GPUBufferUsage.COPY_SRC);
  const args = make(24, STORAGE | GPUBufferUsage.INDIRECT);
  const gatherArgs = make(12, GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(gatherArgs, 0, new Uint32Array([0, 1, 1]));
  const uniforms = make(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const module = device.createShaderModule({ code: lightListShader(slots) });
  const read = { type: 'read-only-storage' } as const,
    write = { type: 'storage' } as const;
  const kinds = [read, { type: 'uniform' } as const, read, read, write, write, write];
  const bindLayout = device.createBindGroupLayout({
    entries: kinds.map((buffer, binding) => ({ binding, visibility: COMPUTE, buffer })),
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
  const stage = (entryPoint: string) =>
    device.createComputePipeline({ layout, compute: { module, entryPoint } });
  const [mapPipeline, headPipeline, gatherPipeline] = ['mapRows', 'listHead', 'gatherRows'].map(
    stage,
  );
  const uniData = new Uint32Array(8);
  // Every row the map may name is unwritten: the first light run maps them all.
  let pendingFrom = 0,
    pendingTo = NO_ROW - 1;
  let boundLog: DrawnLog | undefined, bindGroup: GPUBindGroup | undefined;
  return {
    list,
    args,
    /** Rows `[from, to]` were just uploaded: the next light run maps them. */
    markRows(from: number, to: number) {
      if (to < from) return;
      pendingFrom = Math.min(pendingFrom, from);
      pendingTo = Math.max(pendingTo, to);
    },
    encode(encoder: GPUCommandEncoder, rows: number, log: DrawnLog) {
      if (log !== boundLog) {
        boundLog = log;
        const bound = [itemsBuf, uniforms, log.buffer, log.work, rowOf, list, args];
        bindGroup = device.createBindGroup({
          layout: bindLayout,
          entries: bound.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      }
      const mapping = pendingTo >= pendingFrom && rows > pendingFrom;
      uniData[0] = rows;
      if (mapping) {
        uniData[1] = pendingFrom;
        uniData[2] = Math.min(pendingTo, rows - 1);
      }
      uniData[3] = log.offset;
      uniData[4] = log.countWord;
      // The runs of one frame write the same words: the queue applies them all before the buffer runs.
      device.queue.writeBuffer(uniforms, 0, uniData);
      encoder.copyBufferToBuffer(log.work, log.groupsWord * 4, gatherArgs, 0, 4);
      const pass = encoder.beginComputePass({ label: 'WG light row list' });
      pass.setBindGroup(0, bindGroup!);
      if (mapping) {
        pass.setPipeline(mapPipeline);
        pass.dispatchWorkgroups(Math.ceil((uniData[2] - uniData[1] + 1) / WORKGROUP));
        pendingFrom = NO_ROW;
        pendingTo = -1;
      }
      pass.setPipeline(headPipeline);
      pass.dispatchWorkgroups(1);
      pass.setPipeline(gatherPipeline);
      pass.dispatchWorkgroupsIndirect(gatherArgs, 0);
      pass.end();
    },
  };
}
