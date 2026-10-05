import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

type Creates = Record<string, (descriptor: object) => unknown>;

/**
 * `device`'s pipeline creations, counted: the synchronous ones — those a frame would make — and
 * the async ones, which land when the test says (`land`, each compile asked so far), or a task
 * after they are asked under `auto`. A device without the async forms is given them.
 */
export function gateCompiles(device: GPUDevice, { auto = false } = {}) {
  const creates = device as unknown as Creates;
  const waiting: Array<() => void> = [];
  const compiled = { sync: 0, async: 0 };
  const landed = () =>
    new Promise<void>((done) => (auto ? setTimeout(done) : void waiting.push(done)));
  for (const kind of ['createRenderPipeline', 'createComputePipeline']) {
    const create = creates[kind]?.bind(device);
    if (!create) continue;
    creates[kind] = (descriptor) => (compiled.sync++, create(descriptor));
    creates[`${kind}Async`] = async (descriptor) => {
      compiled.async++;
      await landed();
      return create(descriptor);
    };
  }
  /** Lands every compile asked so far, and lets them settle. */
  const land = async () => {
    for (const done of waiting.splice(0)) done();
    await new Promise((settled) => setImmediate(settled));
  };
  return { compiled, land };
}

/** The kit's recording device, its compiles gated (`gateCompiles`). */
export function gatedDevice(...options: Parameters<typeof fakeDevice>) {
  const fake = fakeDevice(...options);
  return { ...fake, ...gateCompiles(fake.device) };
}
