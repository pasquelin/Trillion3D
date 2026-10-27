import { Object3D } from '../object/object3d.ts'
import type { Light } from './light.ts'
import { lightChanged } from './lightNumbers.ts'

/**
 * The lighting channels of a light (`Light.lightingChannels`) are the node's own (`Object3D.lightingChannels`,
 * held with the node's other switches): a light is a node, and a node that is in channels is in them whether
 * it lights or is lit. What a light adds is that a write reaches the world's light store at once.
 */
export function defineLightingChannels(proto: Light) {
  const inherited = Object.getOwnPropertyDescriptor(Object3D.prototype, 'lightingChannels')!
  Object.defineProperty(proto, 'lightingChannels', {
    configurable: true,
    enumerable: true,
    get: inherited.get,
    set(this: Light, value: unknown) {
      inherited.set!.call(this, value)
      lightChanged(this)
    },
  })
}
