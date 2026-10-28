import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

// What a trace of the frames' holds reads of a view (`noteHold`, `deviceAnswer.ts`): kept on the view's run, read through it.

/** The answer `rt`'s frames were last held on, none when the last frame asked had its answers. */
export const heldOnAnswer = (rt: Pick<WebgpuPagesRuntime, 'run'> | undefined) => rt?.run.hold.heldOn

/** The last frame that entered on `rt`, as `noteHold` wrote it. */
export const lastHold = (rt: Pick<WebgpuPagesRuntime, 'run'> | undefined) => rt?.run.hold.last
