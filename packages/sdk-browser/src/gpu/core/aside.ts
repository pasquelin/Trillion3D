import type { GpuCut, SelectionSubmission, SelectionUniforms } from './selection.ts'

/** A view's cut beside the main one, on the selection's own tables (`../dag/aside.ts`). */
export type AsideCut = {
  /** Cuts `uniforms` into `shared`, the view's command buffer: its mask for this image, and its
   *  two lists read back into the view's own slot once the returned callback says the buffer was
   *  queued. `undefined` when no cut runs — a list being grown —: the view keeps its image. */
  dispatch(uniforms: SelectionUniforms, shared: GPUCommandEncoder): SelectionSubmission | undefined
  /** The view's last readback, a new object per readback; null before the first. */
  peek(): GpuCut | null
  /** Resolves once every readback in flight landed and the tables' growth in flight is made, with
   *  the last readback. */
  flush(): Promise<GpuCut | null>
  dispose(): void
}
