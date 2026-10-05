/** What a module dispatches into: a compute pass opened when the module asks for it. */
export type OpenPass = { readonly pass: GPUComputePassEncoder };

/**
 * One compute pass that several modules dispatch into, opened by the first that dispatches and
 * ended only if one did: a frame whose modules all have nothing to do encodes no empty pass, and
 * no module needs to tell its caller beforehand whether it will dispatch. Each frame `begin`s it
 * on its encoder; a module reads `pass` only once it knows it dispatches. Held by its call site
 * for the session: nothing is allocated per frame.
 */
export class LazyComputePass implements OpenPass {
  private readonly descriptor: GPUComputePassDescriptor;
  private encoder: GPUCommandEncoder | undefined;
  private open: GPUComputePassEncoder | undefined;

  constructor(label: string) {
    this.descriptor = { label };
  }

  /** The frame's pass on `encoder`, not open yet. */
  begin(encoder: GPUCommandEncoder) {
    this.encoder = encoder;
    this.open = undefined;
    return this;
  }

  get pass() {
    return (this.open ??= this.encoder!.beginComputePass(this.descriptor));
  }

  /** Ends the pass if a module opened it. */
  end() {
    this.open?.end();
    this.open = this.encoder = undefined;
  }
}
