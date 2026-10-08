// A session of two roots the GPU composes under a parent, for the compose tests: its selection
// counts the world revisions it is told of, its device records what it is asked.
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { encodeComposedRoots } from './gpuCompose.ts'
import { createPlacementRows } from './rows.ts'
import { composeRuntime } from './composeRuntime.fixture.ts'

/** A parent's world turned by `angle` about y, moved off the origin. */
export const turn = (angle: number) => {
  const c = Math.cos(angle),
    s = Math.sin(angle)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 2, 0, -3, 1]
}

/** A session of two linked roots, its selection counting the world revisions it is told of. */
export function session() {
  const fake = fakeDevice(),
    device = fake.device as unknown as GPUDevice
  // The recording device's compute pipeline is its stage; the pass binds through its layout.
  const createComputePipeline = device.createComputePipeline.bind(device)
  const compiled = { sync: 0, async: 0 }
  const bindable = (descriptor: GPUComputePipelineDescriptor) =>
    Object.assign(createComputePipeline(descriptor), { getBindGroupLayout: () => ({}) })
  device.createComputePipeline = (descriptor) => (compiled.sync++, bindable(descriptor))
  device.createComputePipelineAsync = async (descriptor) => (compiled.async++, bindable(descriptor))
  const rows = createPlacementRows(2)
  const roots = [0, 1].map((index) => ({
    placement: { rows, index },
    world: { elements: new Float32Array(turn(index)) },
  }))
  let revision = 0
  const selection = {
    worldRanges: [
      {
        first: 0,
        count: 2,
        buffer: device.createBuffer({
          size: 128,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
      },
    ],
    worldsMovedOnGpu: () => void revision++,
  }
  const rt = composeRuntime(roots, {
    frame: 0,
    gpuSelection: selection,
    gpuComputeDispatches: 0,
  })
  const encoder = {
    beginComputePass: () => ({
      setPipeline() {},
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder
  const frame = () => {
    rt.run.frame++
    encodeComposedRoots(rt, device, encoder)
    return revision
  }
  return {
    rt,
    rows,
    frame,
    device,
    encoder,
    compiled,
    writes: fake.writes,
    bindGroups: fake.bindGroups,
  }
}
