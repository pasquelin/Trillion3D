// The water pass compiled on the kit's device and its frame ready to replay, for the pass tests
// (`quad.test.ts`, `lobedStage.test.ts`).
import { createWaterPass } from './waterPass.ts'
import { prepared, replay, targets } from './pass.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** A water pass compiled on a device of its own (`fake`, its pipelines' records; `water`), set on a prepared
 *  blend state over the replay's targets, and the frame to replay it into (`replay`). */
export async function recordedWaterPass() {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const fake = fakeDevice()
  const water = await createWaterPass(fake.device, {} as never, {} as never, true)
  blendState.water = water
  return { ...replay(blendState, gpu), blendState, gpu, fake, water }
}
