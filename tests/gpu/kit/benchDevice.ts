import { installGpu } from '../../../bench/dawn/device.ts'
import { openGpuDevice } from './webgpuDevice.ts'

/** The bench's GPU on Dawn, unconstrained, and the engine's device on it with timestamp queries
 *  (`openGpuDevice`): what every proof of the bench opens first. */
export async function openBenchDevice() {
  const gpu = installGpu({ limits: null, featuresOff: [] })
  const opened = await openGpuDevice(['timestamp-query'])
  if (!opened) throw new Error('Dawn must grant an adapter')
  return { gpu, device: opened.device }
}
