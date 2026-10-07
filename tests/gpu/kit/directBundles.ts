// The engine records the passes whose commands repeat as WebGPU render bundles and replays them.
// What a bundle draws is proved against the same commands encoded directly in the pass: while
// `withDirectBundles` runs, a bundle encoder only records its commands (`fakeBundleEncoder`)
// and a pass's `executeBundles` encodes them on itself, on the real device — the image the engine
// drew before it used bundles. Both act on the WebGPU prototypes of this process, never on an
// import, and give back what they replaced.
import { fakeBundleEncoder, replayBundles } from '../../kit/gpu/fakeBundles.ts'
import { untag } from '../../kit/gpu/fakeWebgpuDevice.ts'

type Method = (...args: unknown[]) => unknown
const device = () => GPUDevice.prototype as unknown as Record<string, Method>
const pass = () => GPURenderPassEncoder.prototype as unknown as Record<string, Method>

/** Until the returned call, bundles are recorded and executed by what `patch` makes of the
 *  prototypes' own `createRenderBundleEncoder` and `executeBundles`. */
function patchBundles(patch: (create: Method, execute: Method) => [Method, Method]) {
  const create = device().createRenderBundleEncoder,
    execute = pass().executeBundles
  const [record, replay] = patch(create, execute)
  device().createRenderBundleEncoder = record
  pass().executeBundles = replay
  return () => {
    device().createRenderBundleEncoder = create
    pass().executeBundles = execute
  }
}

/** While `act` runs, every bundle the engine executes is encoded as its commands; the prototypes
 *  are given back when it ends, thrown or not. */
export async function withDirectBundles<T>(act: () => Promise<T> | T): Promise<T> {
  const restore = patchBundles(() => [
    (descriptor) => fakeBundleEncoder(descriptor as GPURenderBundleEncoderDescriptor),
    function (this: GPURenderPassEncoder, bundles) {
      replayBundles(this, bundles as GPURenderBundle[])
    },
  ])
  try {
    return await act()
  } finally {
    restore()
  }
}

/** Counts, until `restore`, the bundles recorded — and the labels the engine wrote for them, the
 *  session's tag taken off (`sessionHandle.ts`) — and the bundle lists executed. */
export function countBundles() {
  const counts = { recorded: 0, executed: 0, labels: new Set<string>() }
  const restore = patchBundles((create, execute) => [
    function (this: GPUDevice, ...args) {
      counts.recorded++
      counts.labels.add(untag((args[0] as GPURenderBundleEncoderDescriptor).label) ?? '')
      return create.apply(this, args)
    },
    function (this: GPURenderPassEncoder, ...args) {
      counts.executed++
      return execute.apply(this, args)
    },
  ])
  return { counts, restore }
}
