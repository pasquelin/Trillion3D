import { fakeDevice } from './fakeDevice.ts'

/**
 * `fakeDevice()`'s command encoder and its dispatches (`calls`, each with its `entryPoint` as
 * `entry`), under the name the partition's test read before the kit held one encoder: a thin view
 * for that test alone, until it reads `fakeDevice` itself; nothing else uses it. `calls` is read
 * when the test reads it, after it encoded.
 */
export function recordingEncoder() {
  const { device, dispatches } = fakeDevice()
  const calls = new Proxy([] as Array<(typeof dispatches)[number] & { entry: string }>, {
    get(_, key) {
      const now = dispatches.map((call) => ({ ...call, entry: call.entryPoint }))
      const value: unknown = Reflect.get(now, key)
      return typeof value === 'function' ? value.bind(now) : value
    },
  })
  return { encoder: device.createCommandEncoder(), calls }
}
