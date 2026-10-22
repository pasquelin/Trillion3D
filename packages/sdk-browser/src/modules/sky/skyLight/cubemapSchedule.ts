/**
 * WHAT A SPECIFIED CUBEMAP'S CAPTURE DOES IN A FRAME. Pure: it decides, `capture.ts` encodes. The
 * capture is done once for a cube, an angle, a side and a lower-hemisphere flag, whole in a frame
 * (the copy, the mips, the filter of every mip, the harmonics), not sliced. A 32-bit float cube is
 * first measured: its brightest value is found on the GPU in one frame, read back the next, and
 * the capture follows the frame the value is known in.
 * - `measure`: the brightest value is computed;
 * - `map`: the buffer that holds it is mapped, the frame that wrote it having been submitted;
 * - `copy`: the whole capture.
 */
export type CubemapStep = 'measure' | 'map' | 'copy' | 'nothing'

type Phase = 'measure' | 'submitted' | 'mapping' | 'copy' | 'done'

/** The capture's memory between frames. */
export interface CubemapState {
  phase: Phase
}

/** A cube's capture: measured first when its texels are 32-bit floats (`wide`). */
export const newCubemapState = (wide: boolean): CubemapState => ({
  phase: wide ? 'measure' : 'copy',
})

/** The state after one more frame, mutated in place, and what that frame does. */
export function advanceCubemap(state: CubemapState): CubemapStep {
  switch (state.phase) {
    case 'measure':
      state.phase = 'submitted'
      return 'measure'
    case 'submitted':
      state.phase = 'mapping'
      return 'map'
    case 'copy':
      state.phase = 'done'
      return 'copy'
    default:
      return 'nothing'
  }
}

/** The brightest value is known: the next frame captures. */
export function cubemapMeasured(state: CubemapState) {
  if (state.phase === 'mapping') state.phase = 'copy'
}
