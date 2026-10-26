/**
 * A LIST THE GPU FILLS AND DISPATCHES OVER: a buffer whose head is the indirect arguments of the
 * kernels that run over it — the workgroups along x and y, one — and the count, then the entries. A
 * kernel appends through `<name>Append`, which adds to the count and, where its entries open a new
 * workgroup's slice, raises the arguments to hold them, in the engine's one split of a dispatch into
 * rows (`groupGrid`, `grid.ts`); a kernel that runs over the list reads its entry's rank off its
 * builtins the same way (`flatIndex`), a thread past the count returning at once. No read back: the
 * CPU sets the head every image (`resetList`) and the GPU alone decides how many threads run.
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from './grid.ts'

/** Words of a list's head: the indirect dispatch's three and the count. */
const LIST_HEAD = 4

/** The head a list starts each image with: no workgroup, one deep, no entry. */
const RESET = new Uint32Array([0, 0, 1, 0])

/** A list's head set for an image: no entry yet, so nothing to dispatch. */
export const resetList = (device: GPUDevice, list: GPUBuffer) =>
  device.queue.writeBuffer(list, 0, RESET)

/** The head every list starts with, once a device: what `resetListIn` copies. */
const headSource = oncePerDevice((device: GPUDevice) => {
  const source = device.createBuffer({
    label: 'Trillion3D list head',
    size: RESET.byteLength,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(source, 0, RESET)
  return source
})

/** A list's head set for an image by the commands of `encoder`, at the point they stand: a copy,
 *  not a write on the queue for each list. */
export const resetListIn = (device: GPUDevice, encoder: GPUCommandEncoder, list: GPUBuffer) =>
  encoder.copyBufferToBuffer(headSource(device), 0, list, 0, RESET.byteLength)

/** Bytes of a list of `entries` entries of `words` words each. */
export const listBytes = (entries: number, words: number) => (LIST_HEAD + entries * words) * 4

/** A list of `entries` entries of `words` words each. */
export const createList = (device: GPUDevice, label: string, entries: number, words: number) =>
  device.createBuffer({
    label,
    size: listBytes(entries, words),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })

/** Where and how a program binds a list: its name, its group and binding, its entry's type, and
 *  whether it appends (a list a dispatch is driven by is bound read alone in that dispatch). */
export type ListBinding = {
  name: string
  group: number
  binding: number
  entry: string
  append: boolean
}

/**
 * A list as a program declares it (`ListBinding`): its head and entries (`<name>.count`,
 * `<name>.entries`) and, where it appends, `<name>Append(n, lanes)`, the rank of the first of `n`
 * entries, the dispatch raised where they open a slice of `lanes`.
 */
export const listWgsl = ({ name, group, binding, entry, append }: ListBinding) => {
  const type = `${name[0].toUpperCase()}${name.slice(1)}List`
  const word = (field: string) => (append ? `${field}:atomic<u32>` : `${field}:u32`)
  const head = `struct ${type}{${word('x')},${word('y')},one:u32,${word('count')},entries:array<${entry}>,}
@group(${group}) @binding(${binding}) var<storage,${append ? 'read_write' : 'read'}> ${name}:${type};`
  return wgslBlock(
    `listWgsl(${name}, ${group}, ${binding}, ${entry}, ${append})`,
    [GROUP_GRID_WGSL, FLAT_INDEX_WGSL, ceilDivWgsl],
    append
      ? `${head}
fn ${name}Append(n:u32,lanes:u32)->u32{
 let at=atomicAdd(&${name}.count,n);
 if(ceilDiv(at+n,lanes)>ceilDiv(at,lanes)){
  let grid=groupGrid(ceilDiv(at+n,lanes));
  atomicMax(&${name}.x,grid.x);
  atomicMax(&${name}.y,grid.y);
 }
 return at;
}`
      : head,
  )
}
