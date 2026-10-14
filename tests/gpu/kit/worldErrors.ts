// The GPU errors a world's own device raises: a world asks for its device itself (`holdWorldDevice`), which
// the proof's device errors (`runOnDevice`) do not see. Listened for from the adapter's grant, before the world
// is made; the proof asserts the list is empty.
import { hookAfter, type Proto } from '../../../bench/dawn/hook.ts'
import { onGrantedDevices } from './grantedDevices.ts'

/** What the devices granted since a call of `listenToWorldDevices` raise and make. */
type WorldSink = {
  errors: string[]
  made: Map<string, GPUBuffer>
  textures: Map<string, GPUTexture>
}

/** The sink the next granted device fills; the hook is installed once a process. */
let current: WorldSink | undefined

/** Listens on every device the page's WebGPU grants from now on; the errors it raises fill the list, and
 *  the buffers and textures it makes are kept by label (`made`, `textures`), for a proof that reads one.
 *  The page's WebGPU is hooked once a process: a family proof draws every case in one process, and each
 *  case's call gives the devices granted from then on a sink of their own, the earlier ones keeping theirs. */
export function listenToWorldDevices() {
  const hooked = current !== undefined
  current = { errors: [], made: new Map(), textures: new Map() }
  if (hooked) return current
  onGrantedDevices((device) => {
    const sink = current!
    device.addEventListener('uncapturederror', (event) => sink.errors.push(event.error.message))
    const keep =
      <T>(into: Map<string, T>) =>
      (_device: object, [descriptor]: never[], resource: unknown) => {
        const label = (descriptor as GPUObjectDescriptorBase).label
        if (label) into.set(label, resource as T)
      }
    hookAfter(device as unknown as Proto, 'createBuffer', keep(sink.made))
    hookAfter(device as unknown as Proto, 'createTexture', keep(sink.textures))
  })
  return current
}

/** The newest resource of `made` (a list `listenToWorldDevices` keeps) whose label passes `test`. */
export const latestMade = <T>(made: Map<string, T>, test: (label: string) => boolean) =>
  [...made].reverse().find(([label]) => test(label))?.[1]
