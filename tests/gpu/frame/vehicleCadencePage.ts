// The page of the moving-vehicle cadence proof (`vehicleCadence.gpu.ts`): a generated car driven at
// full throttle over a generated terrain, through the public SDK alone, its chase camera written in
// `world.beforeFrame`, the world leading its own loop on a display of 120 Hz the page plays.
//
// The display: a refresh every `REFRESH` ms of its own time; at each, the frames the page asked
// for run at the refresh's timestamp (the document timeline the engine reads), unless the display
// still queues `QUEUED` images. An image drawn is run on the GPU alone — the page waits for the
// device's answer — and its GPU time, after the images before it, places it on the display: shown
// at the first refresh after its work ends, as a compositor shows it. The GPU times are the
// device's own, the engine's timer reads them; the display's time runs as the frames need, so a
// machine whose main thread is slow plays the same display.
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import { measurementSdk, proofCanvas } from '../kit/renderHarness.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

/** The display's refresh, ms, and the images it queues at most. */
export const REFRESH = 1000 / 120
const QUEUED = 2

/** One drawn frame, as the page read it in `world.onFrame`. */
export type CadenceFrame = {
  /** The refresh it was drawn at, and the one its image was shown at. */
  drawn: number
  shown: number
  /** The world's seconds the frame stepped (`FrameInfo.delta`). */
  delta: number
  /** The angle, radians, between the camera's forward and the car, as the frame drew them. */
  aim: number
  /** The car's place as the frame drew it. */
  at: [number, number, number]
  /** The GPU time of the image, ms, as the device answered it. */
  gpu: number
}

export type CadenceReading = { frames: CadenceFrame[]; refreshes: number; speed: number }

/** The terrain's height at `x, z`: gentle rolls a car drives over. */
const height = (x: number, z: number) => 0.4 * Math.sin(x / 13) * Math.sin(z / 17)

/** The device the world asks for, caught as the page's GPU hands it out. */
function catchDevice() {
  const caught: { device?: GPUDevice } = {}
  const gpu = navigator.gpu,
    ask = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (options) => {
    const adapter = await ask(options)
    if (adapter) {
      const make = adapter.requestDevice.bind(adapter)
      adapter.requestDevice = async (descriptor) => (caught.device = await make(descriptor))
    }
    return adapter
  }
  return { caught, restore: () => void (gpu.requestAdapter = ask) }
}

/** The page's display (`REFRESH`): the frames asked, run when a refresh comes. */
function playDisplay() {
  let asked = new Map<number, FrameRequestCallback>(),
    next = 1
  const scope = globalThis as unknown as {
    requestAnimationFrame: typeof requestAnimationFrame
    cancelAnimationFrame: typeof cancelAnimationFrame
  }
  const [request, cancel] = [scope.requestAnimationFrame, scope.cancelAnimationFrame]
  scope.requestAnimationFrame = (callback) => (asked.set(next, callback), next++)
  scope.cancelAnimationFrame = (id) => void asked.delete(id)
  return {
    get waiting() {
      return asked.size
    },
    /** Runs the frames asked before refresh `k`, at its timestamp. */
    refresh(k: number) {
      const time = k * REFRESH
      ;(document as unknown as { timeline: { currentTime: number } }).timeline.currentTime = time
      const due = asked
      asked = new Map()
      for (const callback of due.values()) callback(time)
    },
    restore() {
      scope.requestAnimationFrame = request
      scope.cancelAnimationFrame = cancel
    },
  }
}

/**
 * Drives the car for `seconds` of the display's time on a canvas drawn at `pixelRatio` (the GPU's
 * load: a ratio of 3 draws nine times the pixels of 1), and reads every frame drawn.
 */
export function run({ seconds, pixelRatio }: { seconds: number; pixelRatio: number }) {
  return runOnDevice<CadenceReading>(async (_device, _events, result) => {
    const sdk = await measurementSdk()
    const { caught, restore } = catchDevice()
    const display = playDisplay()
    const canvas = proofCanvas(`vehicle-cadence-${pixelRatio}`)
    const world = sdk.createWorld(canvas, { physics: true, pixelRatio, renderScale: 1 })
    try {
      await world.ready
      world.scene.background = sdk.math.color('#9cc3d9')
      world.camera.far = 600
      const sun = sdk.light.directional({ intensity: 3, color: '#fff4e2', castShadow: true })
      sun.position.set(40, 60, -20)
      world.scene.add(sun, sdk.light.hemisphere({ intensity: 1.2 }))
      // The terrain: 400 m square, 160 cells a side, its height rolled, simulated as its triangles.
      const ground = sdk.geometry.plane(400, 400, 160, 160).rotateX(-HALF_PI)
      const place = ground.getAttribute('position')!
      for (let i = 0; i < place.count; i++)
        place.array[i * 3 + 1] = height(place.array[i * 3], place.array[i * 3 + 2])
      place.needsUpdate = true
      ground.computeVertexNormals()
      const terrain = sdk.object.mesh(
        ground,
        sdk.material.meshStandard({ color: '#6f8f4f', roughness: 0.9, physics: 'stone' }),
      )
      terrain.physics = { type: 'static', shape: { type: 'triangles' } }
      // The car: the body of `VEHICLE_SPECS`'s machine, four wheels at their rest, facing −z.
      const paint = sdk.material.meshStandard({ color: '#c03020', metalness: 0.6, roughness: 0.3 })
      const body = sdk.object.mesh(sdk.geometry.box(1.8, 0.5, 4.4), paint)
      body.physics = { mass: 1470 }
      body.position.set(0, height(0, 0) + 0.33 + 0.3 + 0.05, 0)
      const rubber = sdk.material.meshStandard({ color: '#202020', roughness: 0.8 })
      const wheels = [-1, 1].flatMap((z) =>
        [-0.8, 0.8].map((x) => {
          const wheel = sdk.object.mesh(sdk.geometry.cylinder(0.33, 0.33, 0.25), rubber)
          wheel.position.set(x, -0.3, z * 1.33)
          wheel.rotation.z = HALF_PI
          body.add(wheel)
          return wheel
        }),
      )
      world.scene.add(terrain, body)
      const car = sdk.vehicle.car(body, { wheels })
      world.physics.add(car)
      car.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false })
      // The chase camera, ahead of each frame: the pose this frame draws (`docs/SDK.md`, Loop).
      world.beforeFrame(() => {
        world.camera.position.set(0, 2.5, 7).applyQuaternion(body.quaternion).add(body.position)
        world.camera.lookAt(body.position)
        world.invalidate()
      })
      const frames: CadenceFrame[] = []
      /** The frame the last refresh drew, if it drew one. */
      const last: { frame?: Omit<CadenceFrame, 'shown' | 'gpu'> } = {}
      let k = 0
      const forward = sdk.math.vector3()
      world.onFrame(({ delta }) => {
        const { position } = body,
          eye = world.camera.position
        world.camera.getWorldDirection(forward)
        const to = [position.x - eye.x, position.y - eye.y, position.z - eye.z]
        const cos =
          (to[0] * forward.x + to[1] * forward.y + to[2] * forward.z) / length3(to[0], to[1], to[2])
        last.frame = {
          drawn: k,
          delta,
          aim: Math.acos(Math.min(1, cos)),
          at: [position.x, position.y, position.z],
        }
      })
      const refreshes = Math.round((seconds * 1000) / REFRESH)
      const shown: number[] = []
      let free = 0
      for (k = 0; k < refreshes; k++) {
        const time = k * REFRESH
        const queued = shown.filter((at) => at > time + 1e-6).length
        if (display.waiting && queued < QUEUED) {
          last.frame = undefined
          display.refresh(k)
          const drawn = last.frame as Omit<CadenceFrame, 'shown' | 'gpu'> | undefined
          if (drawn && caught.device) {
            // The image's work alone on the GPU: its time, after the images before it.
            const start = performance.now()
            await caught.device.queue.onSubmittedWorkDone()
            const gpu = performance.now() - start
            free = Math.max(free, time) + gpu
            const at = Math.ceil(free / REFRESH - 1e-9) * REFRESH
            shown.push(at)
            frames.push({ ...drawn, shown: at / REFRESH, gpu })
          }
        }
        // The engine's answers, the physics worker's ticks and the pages land between refreshes.
        await new Promise((done) => setTimeout(done, 0))
        if (world.physics.error) throw new Error(String(world.physics.error))
      }
      result.frames = frames
      result.refreshes = refreshes
      result.speed = car.speed
    } finally {
      world.dispose()
      display.restore()
      restore()
      canvas.remove()
    }
  })
}
