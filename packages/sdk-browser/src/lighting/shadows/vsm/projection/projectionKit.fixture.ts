// The shadow projection on the kit's device, as the projection proofs encode it: one device of a
// 2²⁷-byte binding, its shadow resources, the frame's inputs as views nothing reads, and the view
// uniform the pass uploads.
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../resources.ts'
import {
  encodeVirtualShadowProjection,
  writeVsmProjectionFrame,
  type VsmProjectionFrame,
  type VsmProjectionLight,
} from './projectionPass.ts'
import { fakeHizDepth } from '../hizDepth.fixture.ts'
import { camera } from './projectionScene.fixture.ts'

type Frame = VsmProjectionFrame

/** The camera the proofs look through: at the origin, a perspective of near 0.1. */
const PROOF_CAMERA: Frame['camera'] = camera

/** The kit's device and its shadow resources; `project` encodes the projection of `lights` on its
 *  one encoder, the frame `PROOF_CAMERA`'s, frame 1, 64 × 32, unless `frame` says otherwise; the
 *  view uniform the last projection uploaded (`upload`). */
export function projectionKit() {
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(fake.device, { fullMapCapacity: 63, poolPages: 256 })
  const view = {} as GPUTextureView
  const source = {
    depth: view,
    normalRough: view,
    flags: view,
    receiver: view,
  }
  const target = { view, tilesView: view }
  const encoder = fake.device.createCommandEncoder()
  const project = (lights: VsmProjectionLight[], frame: Partial<Frame> = {}) => {
    const context: Frame = {
      device: fake.device,
      hizDepth: fakeHizDepth,
      ...{ width: 64, height: 32, camera: PROOF_CAMERA, frameIndex: 1 },
      ...frame,
      lights,
    }
    writeVsmProjectionFrame(res, context)
    encodeVirtualShadowProjection(encoder, res, context, source, target)
  }
  const upload = () => fake.writes.findLast((w) => w.buffer.label === 'vsm.projection.view')
  return { ...fake, res, encoder, project, upload }
}
