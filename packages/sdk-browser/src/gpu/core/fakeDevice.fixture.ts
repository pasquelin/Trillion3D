// A WebGPU device stand-in for the ownership and handle tests, and an owner that records.
type Described = { label?: string } | undefined;
const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };

/**
 * A device as WebGPU writes one: its members on the prototype, each creation refusing a `this`
 * that is not a device ("Illegal invocation"), and its events through `EventTarget`. `given`
 * records every descriptor a creation received; `queued` every queue call.
 */
export class FakeDevice extends EventTarget {
  readonly given: Described[] = [];
  readonly queued: string[] = [];
  readonly #queue = {
    writeBuffer: () => this.queued.push('writeBuffer'),
    writeTexture: () => this.queued.push('writeTexture'),
    copyExternalImageToTexture: () => this.queued.push('copyExternalImageToTexture'),
    submit: () => this.queued.push('submit'),
    onSubmittedWorkDone: async () => void this.queued.push('onSubmittedWorkDone'),
  };
  readonly #lost: Promise<GPUDeviceLostInfo>;
  lose!: (info: GPUDeviceLostInfo) => void;
  constructor() {
    super();
    this.#lost = new Promise((resolve) => (this.lose = resolve));
  }
  #made(descriptor: Described) {
    if (!(#queue in this)) throw new TypeError('Illegal invocation');
    this.given.push(descriptor);
    return { label: descriptor?.label, destroy() {}, createView: () => ({}) };
  }
  get queue() {
    return this.#queue;
  }
  get lost() {
    return this.#lost;
  }
  get limits() {
    return { minUniformBufferOffsetAlignment: 256 };
  }
  createBuffer(descriptor: GPUBufferDescriptor) {
    return this.#made(descriptor) as unknown as GPUBuffer;
  }
  createTexture(descriptor: GPUTextureDescriptor) {
    return this.#made(descriptor) as unknown as GPUTexture;
  }
  createQuerySet(descriptor: GPUQuerySetDescriptor) {
    return this.#made(descriptor) as unknown as GPUQuerySet;
  }
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor) {
    return { ...this.#made(descriptor), beginRenderPass: () => pass, finish: () => ({}) };
  }
  createBindGroup(descriptor: GPUBindGroupDescriptor) {
    return this.#made(descriptor);
  }
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor) {
    return this.#made(descriptor);
  }
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor) {
    return this.#made(descriptor);
  }
  createShaderModule(descriptor: GPUShaderModuleDescriptor) {
    return this.#made(descriptor);
  }
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
    return this.#made(descriptor);
  }
  /** Raises an uncaptured error as WebGPU does; returns whether the listener cancelled it. */
  raise(message: string, error: object = { message }) {
    const event = Object.assign(new Event('uncapturederror', { cancelable: true }), { error });
    return !this.dispatchEvent(event);
  }
}
export const fakeDevice = () => new FakeDevice() as FakeDevice & GPUDevice;

/** An owner that records what reaches it. */
export function owner() {
  const errors: string[] = [],
    reasons: string[] = [],
    closed: string[] = [],
    losses: string[] = [];
  return {
    errors,
    reasons,
    closed,
    losses,
    error: (message: string, reason: string) => (errors.push(message), reasons.push(reason)),
    closedError: (message: string) => closed.push(message),
    lost: (info: { reason: string }) => losses.push(info.reason),
  };
}
