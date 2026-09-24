// A WebGPU device stand-in for the ownership and handle tests, and an owner that records.
type Described = { label?: string } | undefined;
const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };

/** A texture as WebGPU writes one: `createView` on its prototype, refusing another `this`. */
class FakeTexture {
  readonly label: string | undefined;
  constructor(label: string | undefined) {
    this.label = label;
  }
  createView(view?: Described) {
    if (!(this instanceof FakeTexture)) throw new TypeError('Illegal invocation');
    return { label: view?.label };
  }
  destroy() {}
}

/**
 * A device as WebGPU writes one: its members on the prototype, each refusing a `this` that is not
 * a device ("Illegal invocation"), and its events through `EventTarget`, which checks the same.
 */
export class FakeDevice extends EventTarget {
  readonly #queue = { writeBuffer() {}, submit() {} };
  readonly #lost: Promise<GPUDeviceLostInfo>;
  lose!: (info: GPUDeviceLostInfo) => void;
  constructor() {
    super();
    this.#lost = new Promise((resolve) => (this.lose = resolve));
  }
  /** The platform's brand check: only a device holds the private field. */
  static #check(self: object) {
    if (!(#queue in self)) throw new TypeError('Illegal invocation');
  }
  #made(descriptor: Described) {
    FakeDevice.#check(this);
    return { label: descriptor?.label, destroy() {} };
  }
  get queue() {
    FakeDevice.#check(this);
    return this.#queue;
  }
  get lost() {
    FakeDevice.#check(this);
    return this.#lost;
  }
  get limits() {
    FakeDevice.#check(this);
    return { minUniformBufferOffsetAlignment: 256 };
  }
  createBuffer(descriptor: GPUBufferDescriptor) {
    return this.#made(descriptor) as unknown as GPUBuffer;
  }
  createTexture(descriptor: GPUTextureDescriptor) {
    FakeDevice.#check(this);
    return new FakeTexture(descriptor.label) as unknown as GPUTexture;
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
    counts: Array<{ session: string; count: number }> = [],
    losses: string[] = [];
  return {
    errors,
    reasons,
    closed,
    counts,
    losses,
    error: (message: string, reason: string) => (errors.push(message), reasons.push(reason)),
    closedError: (message: string, sessions: readonly { session: string; count: number }[]) => (
      closed.push(message),
      counts.push(...sessions)
    ),
    lost: (info: { reason: string }) => losses.push(info.reason),
  };
}
