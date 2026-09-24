/**
 * A session's handle on a device the world keeps across sessions (`deviceOwners.ts` says why).
 *
 * A plain object built once per session. Its `create*` join the session's tag to the label, so
 * that an error naming an object names its session (a view is named by its texture: Dawn writes
 * `[TextureView of Texture "label"]`); `limits`, `features` and `lost` are the device's, and its
 * `queue` forwards to the device's. Once released, the handle is inert: a `create*` throws an
 * `AbortError`, so the work still running stops there, and the queue writes and submits nothing.
 * Nothing is allocated per call but the copy of a descriptor that holds more than a label.
 */
const TAG = /@t3d:(\d+)/g;

/** The tag that names session `id` in its labels. */
export const sessionTag = (id: number) => `@t3d:${id}`;
/** The sessions a message names, by id. */
export const tagsIn = (message: string) => Array.from(message.matchAll(TAG), (m) => Number(m[1]));
/** A label as the engine wrote it, without its session's tag. */
export const untag = (label: string | undefined) => label?.replace(/ ?@t3d:\d+$/, '') || undefined;

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

function onlyLabel(descriptor: object) {
  for (const key in descriptor) if (key !== 'label') return false;
  return true;
}

/** `device` as the session tagged `tag` sees it, and `release`, which makes it inert. */
export function sessionHandle(device: GPUDevice, tag: string) {
  let released = false;
  const untitled = { label: tag };
  /** Each label the engine wrote → a descriptor holding it tagged, read back at every use. */
  const named = new Map<string, { label: string }>();
  const labelled = (descriptor: Labelled) => {
    const label = descriptor?.label;
    let tagged = label ? named.get(label) : untitled;
    if (!tagged) named.set(label!, (tagged = { label: `${label} ${tag}` }));
    return !descriptor || onlyLabel(descriptor) ? tagged : { ...descriptor, label: tagged.label };
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
        return target[name](labelled(descriptor));
      };
  if (device.pushErrorScope)
    handle.pushErrorScope = (f: GPUErrorFilter) => device.pushErrorScope(f);
  if (device.popErrorScope) handle.popErrorScope = () => device.popErrorScope();
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
