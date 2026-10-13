/**
 * The pool as a shader outside the VSM passes reads it: the blended surfaces and the water, whose
 * programs are compiled before any pool is granted and whatever the device. They read the first
 * slice (`vsmPoolDepth`), through windows of a fixed size — WebGPU's guaranteed largest storage
 * binding —, each bound to the part of that slice it lies in, at its offset: whatever parts the
 * device's own binding size split the slice into (`vsmLayout`), every texel of the pool is read.
 *
 * A part holds whole page rows, a power of two of them, as many as the device's binding holds: at
 * least a window's, so a part is a whole number of windows, or the slice's only part, smaller than
 * one window. A window past the slice is bound to a stand-in no texel reads.
 */
import { VSM_PAGE_TEXELS, VSM_POOL_PAGES } from './constants.ts'
import { vsmPoolTexelIndexWgsl, type VsmResources } from './resources.ts'
import { vsmLayout, type VsmLayout } from './layout.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'

/** A window of the pool: WebGPU's guaranteed `maxStorageBufferBindingSize`, in bytes. */
const VSM_POOL_WINDOW_BYTES = 2 ** 27

/** The slice's bytes of a layout. */
const sliceBytes = (layout: VsmLayout) =>
  layout.poolTexelsXY[0] * layout.poolTexelsXY[1] * Uint32Array.BYTES_PER_ELEMENT

/** The largest pool the engine grants (`VSM_POOL_PAGES`), at a window's binding size: its row shift
 *  is every pool's, the table's width being fixed. */
const LARGEST = vsmLayout({ fullMapCapacity: 0, poolPages: VSM_POOL_PAGES }, VSM_POOL_WINDOW_BYTES)

/** The windows that pool's slice spans: the bindings a reader outside the VSM passes declares. */
const VSM_POOL_WINDOWS = ceilDiv(sliceBytes(LARGEST), VSM_POOL_WINDOW_BYTES)

/** The bindings a forward pass declares the pool's windows at, from `first`: the engine's largest
 *  pool spans one window, so `first` alone. A pool that grows past it gives the forward layouts a
 *  number a window, which this refuses until they hold them. */
export function vsmPoolWindowBindings(first: number): readonly number[] {
  if (VSM_POOL_WINDOWS !== 1)
    throw new Error(`VSM: the pool spans ${VSM_POOL_WINDOWS} windows, a forward pass binds one`)
  return [first]
}

/**
 * `vsmPoolLoad(t, slice)` over windows of `windowBytes` bound at `bindings`, in group 0: texel `t` of
 * the first slice, 0 past the windows or past the buffer a window is bound to — `slice` is not read.
 */
export function vsmPoolWindowsWgsl(
  bindings: readonly number[],
  windowBytes = VSM_POOL_WINDOW_BYTES,
) {
  const shift = Math.log2(windowBytes / Uint32Array.BYTES_PER_ELEMENT)
  if (!Number.isInteger(shift)) throw new Error('VSM: a pool window is a power of two of words')
  const mask = `${(2 ** shift - 1) >>> 0}u`
  const cases = bindings
    .map(
      (_, k) => ` case ${k}u:{if(i<arrayLength(&vsmPoolWindow${k})){return vsmPoolWindow${k}[i];}}`,
    )
    .join('\n')
  return wgslFn(
    'vsmPoolLoad',
    [
      wgslBlock(
        `vsmPoolWindows(${bindings.join(', ')})`,
        [],
        bindings
          .map(
            (binding, k) =>
              `@group(0) @binding(${binding}) var<storage,read> vsmPoolWindow${k}:array<u32>;`,
          )
          .join('\n'),
      ),
      vsmPoolTexelIndexWgsl('vsmPoolTexelIndex', `${LARGEST.poolRowShift}u`),
    ],
    `fn vsmPoolLoad(t:vec2u,slice:u32)->u32{
 let l=vsmPoolTexelIndex(t);
 let i=l&${mask};
 switch(l>>${shift}u){
${cases}
 default:{}
 }
 return 0u;
}`,
  )
}

/** Window `k` of the first slice of `res`: the part it lies in, at its offset; none past the slice. */
export function vsmPoolWindow(
  res: Pick<VsmResources, 'layout' | 'pagePool'>,
  k: number,
  windowBytes = VSM_POOL_WINDOW_BYTES,
): GPUBufferBinding | undefined {
  const { layout } = res
  const start = k * windowBytes
  if (start >= sliceBytes(layout)) return undefined
  const partBytes =
    layout.poolPageRowsPerPart *
    layout.poolTexelsXY[0] *
    VSM_PAGE_TEXELS *
    Uint32Array.BYTES_PER_ELEMENT
  const part = Math.floor(start / partBytes)
  const buffer = res.pagePool[0][part]
  const offset = start - part * partBytes
  return { buffer, offset, size: Math.min(windowBytes, buffer.size - offset) }
}
