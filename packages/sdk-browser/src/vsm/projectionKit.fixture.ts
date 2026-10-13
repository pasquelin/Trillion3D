// The shadow projection on the kit's device, as the projection proofs encode it: one device of a
// 2²⁷-byte binding, its shadow resources, the frame's inputs as views nothing reads, and the view
// uniform the pass uploads.
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { encodeVirtualShadowProjection, type VsmProjectionLight } from './projectionPass.ts'
import { fakeHizDepth } from './hizDepth.fixture.ts'

type Frame = Parameters<typeof encodeVirtualShadowProjection>[2]

/** The camera the proofs look through: at the origin, a perspective of near 0.1. */
const PROOF_CAMERA: Frame['camera'] = {
  view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0],
  perspective: true,
}

/** The kit's device and its shadow resources; `project` encodes the projection of `lights` on its
 *  one encoder, the frame `PROOF_CAMERA`'s, frame 1, 64 × 32, unless `frame` says otherwise; the
 *  view uniform the last projection uploaded (`upload`). */
export function projectionKit() {
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(fake.device, { fullMapCapacity: 63, poolPages: 256 })
  const view = {} as GPUTextureView
  const inputs = {
    device: fake.device,
    depth: view,
    hizDepth: fakeHizDepth,
    normalRough: view,
    flags: view,
    mask: view,
    maskTiles: view,
  }
  const encoder = fake.device.createCommandEncoder()
  const project = (lights: VsmProjectionLight[], frame: Partial<Frame> = {}) =>
    encodeVirtualShadowProjection(
      encoder,
      res,
      {
        ...inputs,
        ...{ width: 64, height: 32, camera: PROOF_CAMERA, frameIndex: 1, subgroups: false },
        ...frame,
      },
      lights,
    )
  const upload = () => fake.writes.findLast((w) => w.buffer.label === 'vsm.projection.view')
  return { ...fake, res, inputs, encoder, project, upload }
}
