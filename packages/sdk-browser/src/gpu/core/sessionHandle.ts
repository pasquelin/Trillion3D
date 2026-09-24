/**
 * A session's handle on a device the world keeps across sessions (`deviceOwners.ts` says why).
 *
 * A plain object built once per session. Its `create*` join the session's tag to the label, so
 * that an error naming an object names its session (a view is named by its texture: Dawn writes
 * `[TextureView of Texture "label"]`); `limits`, `features` and `lost` are the device's, and its
 * `queue` forwards to the device's. Once released, the handle is inert: a `create*` throws an
 * `AbortError`, so the work still running stops there, and the queue writes and submits nothing.
 * Nothing is allocated per call: each tagged label is made once, and set on the caller's
 * descriptor for the call only.
 */
const TAG = /@t3d:(\d+)/g;
const TAGGED = /@t3d:\d+$/;

/** The tag that names session `id` in its labels. */
export const sessionTag = (id: number) => `@t3d:${id}`;
/** The sessions a message names, by id. */
export const tagsIn = (message: string) => Array.from(message.matchAll(TAG), (m) => Number(m[1]));
/** True when `label` names no session: what the device keeps for every session. */
export const namesNoSession = (label: string | undefined) => !label || !TAGGED.test(label);

const CREATES = [
  'createBuffer',
  'createTexture',
  'createSampler',
  'createBindGroupLayout',
  'createPipelineLayout',
  'createBindGroup',
  'createShaderModule',
  'createComputePipeline',
  'createRenderPipeline',
  'createComputePipelineAsync',
  'createRenderPipelineAsync',
  'createCommandEncoder',
  'createQuerySet',
] as const;

type Labelled = { label?: string } | undefined;
type Queue = Pick<
  GPUQueue,
  'writeBuffer' | 'writeTexture' | 'copyExternalImageToTexture' | 'submit' | 'onSubmittedWorkDone'
>;

/** Each handle → the device behind it. */
const devices = new WeakMap<object, GPUDevice>();

/** The device behind a session's handle — what every session shares is created on it, and the
 *  canvas takes it; `device` itself when it is no handle. */
export const sharedGpuDevice = (device: GPUDevice) => devices.get(device) ?? device;

/** `device` as the session tagged `tag` sees it, and `release`, which makes it inert. */
export function sessionHandle(device: GPUDevice, tag: string) {
  let released = false;
  const untitled = { label: tag };
  /** Each label the engine wrote → the same label tagged, made once. */
  const named = new Map<string, string>();
  const tagged = (label: string) => {
    let name = named.get(label);
    if (name === undefined) named.set(label, (name = `${label} ${tag}`));
    return name;
  };
  const target = device as unknown as Record<string, (descriptor: Labelled) => unknown>;
  const handle: Record<string, unknown> = {
    limits: device.limits,
    features: device.features,
    lost: device.lost,
  };
  for (const name of CREATES)
    if (typeof target[name] === 'function')
      handle[name] = (descriptor: Labelled) => {
        if (released) throw new DOMException(`Session ${tag} released the device`, 'AbortError');
        if (!descriptor) return target[name](untitled);
        // The caller's descriptor carries the tagged label for the call only: the device reads it
        // there and then, and nothing is copied.
        const label = descriptor.label;
        descriptor.label = label ? tagged(label) : tag;
        try {
          return target[name](descriptor);
        } finally {
          if (label === undefined) delete descriptor.label;
          else descriptor.label = label;
        }
      };
  // The device's error scopes are one stack every session shares: a released handle opens none,
  // and closes only those it opened, so it can neither leave one open nor close another's.
  let scopes = 0;
  if (device.pushErrorScope)
    handle.pushErrorScope = (filter: GPUErrorFilter) => {
      if (released) return;
      scopes++;
      device.pushErrorScope(filter);
    };
  if (device.popErrorScope)
    handle.popErrorScope = () => {
      if (!scopes) return Promise.resolve(null);
      scopes--;
      return device.popErrorScope();
    };
  const queue: Queue = {
    writeBuffer(buffer, offset, data, from, size) {
      if (!released) device.queue.writeBuffer(buffer, offset, data, from, size);
    },
    writeTexture(destination, data, layout, size) {
      if (!released) device.queue.writeTexture(destination, data, layout, size);
    },
    copyExternalImageToTexture(source, destination, size) {
      if (!released) device.queue.copyExternalImageToTexture(source, destination, size);
    },
    submit(buffers) {
      if (!released) device.queue.submit(buffers);
    },
    onSubmittedWorkDone: () => device.queue.onSubmittedWorkDone(),
  };
  handle.queue = queue;
  devices.set(handle, device);
  return {
    device: handle as unknown as GPUDevice,
    release() {
      released = true;
    },
  };
}
