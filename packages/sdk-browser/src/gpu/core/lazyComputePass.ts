import { isTimed, TIMED_APART } from './timedEncoder.ts'
import { gpuPassBlockOf, gpuPassStageOf } from '../../diagnostic/stage/mapping.ts'

/** Whether two pass labels are in the same stage and block of the profile. */
const sameRow = (a: string | undefined, b: string | undefined) => {
  if (a === b) return true
  const stage = a && gpuPassStageOf(a)
  // A label the profile does not name is its own row: two of them are two rows.
  return !!stage && stage === (b && gpuPassStageOf(b)) && gpuPassBlockOf(a!) === gpuPassBlockOf(b!)
}

/** What a module dispatches into: a compute pass opened when the module asks for it. */
export type OpenPass = { readonly pass: GPUComputePassEncoder }

/**
 * One compute pass that several modules dispatch into, opened by the first that dispatches and
 * ended only if one did: a frame whose modules all have nothing to do encodes no empty pass, and
 * no module needs to tell its caller beforehand whether it will dispatch. Each frame `begin`s it
 * on its encoder; a module reads `pass` only once it knows it dispatches. Held by its call site
 * for the session: nothing is allocated per frame. Begun on a `ComputeRun`, its pass is a step of
 * the run: it follows the run's other steps in one pass, or is a pass of its own on a timed frame.
 */
export class LazyComputePass implements OpenPass {
  private readonly descriptor: GPUComputePassDescriptor
  private encoder: GPUCommandEncoder | undefined
  private make: (() => GPUCommandEncoder) | undefined
  private open: GPUComputePassEncoder | undefined
  private run: ComputeRun | undefined

  constructor(label: string) {
    this.descriptor = { label }
  }

  /** The frame's pass on `encoder` — or on the one `encoder` makes when a module opens the pass:
   *  a frame whose modules all have nothing to do then makes no command buffer —, not open yet. */
  begin(encoder: GPUCommandEncoder | (() => GPUCommandEncoder) | ComputeRun) {
    const lazy = typeof encoder === 'function'
    this.run = encoder instanceof ComputeRun ? encoder : undefined
    this.encoder = lazy || this.run ? undefined : (encoder as GPUCommandEncoder)
    this.make = lazy ? encoder : undefined
    this.open = undefined
    return this
  }

  get pass() {
    if (this.run) return (this.open ??= this.run.pass(this.descriptor))
    return (this.open ??= (this.encoder ??= this.make!()).beginComputePass(this.descriptor))
  }

  /** Ends the pass if a module opened it: the encoder it was opened on, none when none did — and
   *  none for a pass in a run (`begin(run)`), which the run ends. */
  end() {
    const opened = this.open && this.encoder
    if (!this.run) this.open?.end()
    this.open = this.encoder = this.make = this.run = undefined
    return opened
  }
}

/**
 * A run of compute passes that follow one another on an encoder, with no render pass or copy
 * between them: one pass, a dispatch after the other — the storage barriers between dispatches are
 * the device's —, on a sampled frame as on any other (`isTimedApart`: the detail asks a pass for each step). Held by its call site for
 * the session; `begin` the run on the frame's encoder, ask `pass` with the descriptor of each
 * step (a constant: nothing is allocated per frame), take the encoder from `apart` for a command
 * that is no dispatch, `end` the run before anything else is encoded on the encoder.
 */
export class ComputeRun {
  private encoder: GPUCommandEncoder | undefined
  private timed = false
  private sampled = false
  private open: GPUComputePassEncoder | undefined
  private openLabel: string | undefined

  begin(encoder: GPUCommandEncoder) {
    this.encoder = encoder
    this.sampled = isTimed(encoder)
    this.timed = this.sampled && (encoder as { [TIMED_APART]?: boolean })[TIMED_APART] === true
    this.open = undefined
    return this
  }

  /** The pass to dispatch the step `descriptor` names into: the run's open one, or its own when each step is timed apart. */
  pass(descriptor: GPUComputePassDescriptor) {
    // On a frame sampled for the timing, a step of another stage or block of the profile is a pass of its own: a pass is timed as one and its time goes to its first step's label. An unsampled frame keeps its passes.
    const apart =
      this.timed || (this.sampled && this.open && !sameRow(this.openLabel, descriptor.label))
    if (apart) this.open?.end()
    if (apart || !this.open) {
      this.open = this.encoder!.beginComputePass(descriptor)
      this.openLabel = descriptor.label
    }
    return this.open
  }

  /** The encoder, for a command that is not a dispatch (a copy, a clear, a render pass): the open
   *  pass is ended first, and the next `pass` opens another. */
  apart() {
    this.open?.end()
    this.open = undefined
    return this.encoder!
  }

  /** Ends the pass if a step opened one; whether one did. */
  end() {
    const opened = !!this.open
    this.open?.end()
    this.open = this.encoder = undefined
    return opened
  }
}
