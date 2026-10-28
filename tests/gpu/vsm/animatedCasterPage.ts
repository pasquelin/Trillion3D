// A desk lamp that moves, lit by a shadow-casting spot, on a real world runtime on Dawn: the scene
// of the `keyframes-by-hand` example (a desk, a wall, a hierarchy `hero` of a base and three joint
// groups `lower`, `upper`, `head` holding the meshes, a spot light `beam` in the head that casts no
// shadow, a room spot light that does, a mixer playing keyed tracks of the position, the heading and
// the three joint angles). The same final pose is reached three ways, in a fresh world each:
//   - mixer:  the mixer plays the clip, then stops where it stands;
//   - script: the frame loop writes the joints and the position, frame by frame, as the mixer did;
//   - fresh:  the pose is set before the first frame, nothing ever moved.
// After the same settle frames, the three images must be the same one: a shadow that holds a pose
// the caster has left is a trail. (`animated-caster-trails.gpu.ts` compares them.)
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { lastFrameOf, sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { animation } from '../../../packages/sdk-core/src/world/animation/family.ts'
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'
import { lamp, hopClip, paint, poseOf, writePose, type Pose } from './animatedCasterLamp.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settleBy } from '../world/proofWorld.ts'
import { drawnPixels } from '../../kit/device/sceneImageProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'

/** Frames the lamp moves. */
const MOVE_FRAMES = 240
/** The clip plays this fast, so that its stop falls inside a hop, away from its rest pose. */
const SPEED = 1.5

type World = ReturnType<typeof createWorld>

/** A fresh world with the example's desk, lamp and lights; the lamp at its rest place. */
async function openScene(canvas: HTMLCanvasElement) {
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
    exposureMethod: 'manual',
    exposureApplyPhysicalCamera: false,
  } as Parameters<typeof createWorld>[1])
  await world.ready
  world.exposure = 1
  world.scene.background = math.color('#15171d')
  const hero = lamp()
  hero.position.set(-2.4, 0, 0.3)
  world.scene.add(hero)
  // The bulb lights the desk: a spot in the head; it casts no shadow, it sits inside the bulb.
  const beam = light.spot({
    color: '#fff1c8',
    intensity: 40,
    intensityUnits: 'candelas',
    distance: 8,
    outerConeAngle: 0.7,
    innerConeAngle: 0.28,
    position: [0.38, 0, 0],
    target: [2, 0, 0],
    castShadow: false,
  })
  hero.getObjectByName('head')!.add(beam, beam.target)
  const put = (
    shape: ReturnType<typeof geometry.box>,
    paintOf: ReturnType<typeof paint>,
    at: [number, number, number],
    turn = 0,
  ) => {
    const mesh = object.mesh(shape, paintOf)
    mesh.position.set(...at)
    mesh.rotation.set(0, turn, 0)
    world.scene.add(mesh)
    return mesh
  }
  put(geometry.box(14, 0.3, 7), paint('#6b4128', 0.45), [0, -0.15, 0])
  put(geometry.box(16, 9, 0.3), paint('#c9bba5', 0.9), [0, 4, -3.6])
  put(geometry.box(4.4, 2.6, 0.08), paint('#a8784c', 0.95), [1.6, 3.4, -3.42])
  ;['#f4e27a', '#f2a7a0', '#a9d8c2', '#f7f3ea', '#9ec3f0'].forEach((color, k) =>
    put(
      geometry.box(0.7, 0.8, 0.02),
      paint(color, 0.9),
      [0.1 + k * 0.72, 3.2 + (k % 2) * 0.55, -3.37],
      (k - 2) * 0.02,
    ),
  )
  ;['#8c2f39', '#2f5d8c', '#d9a441', '#3d6b45'].forEach((color, k) =>
    put(
      geometry.box(1.5 - k * 0.1, 0.24, 1.1),
      paint(color, 0.7),
      [-5, 0.12 + k * 0.24, -1.2],
      k * 0.12 - 0.15,
    ),
  )
  put(geometry.cylinder(0.32, 0.3, 0.7, 32), paint('#e9e4dc', 0.3), [4.5, 0.35, -0.9])
  put(geometry.torus(0.2, 0.05, 10, 24), paint('#e9e4dc', 0.3), [4.84, 0.38, -0.9])
  put(geometry.cylinder(0.26, 0.26, 0.8, 24, 1, true), paint('#2f3540', 0.5, 0.6), [3.8, 0.4, -2.2])
  ;['#e04f3f', '#f2c14e', '#3d7ec9'].forEach((color, k) =>
    put(geometry.cylinder(0.03, 0.03, 1.1, 8), paint(color, 0.5), [
      3.72 + k * 0.08,
      0.75,
      -2.2 + (k - 1) * 0.07,
    ]),
  )
  put(geometry.box(2.2, 0.01, 1.6), paint('#f5f1e8', 0.95), [-0.6, 0.005, 1.8], 0.12)
  // A warm spot from high on the left throws the lamp's shadow across the desk and wall.
  world.scene.add(
    light.spot({
      color: '#ffd4a3',
      intensity: 650,
      intensityUnits: 'candelas',
      distance: 30,
      outerConeAngle: 0.62,
      innerConeAngle: 0.279,
      position: [-7, 10, 8],
      castShadow: true,
    }),
    light.hemisphere({ color: '#8aa4ff', groundColor: '#3b2c22', intensity: 0.7 }),
  )
  world.camera.position.set(1.2, 3.3, 8.6)
  world.camera.lookAt(0, 1.1, 0)
  world.camera.updateMatrixWorld(true)
  // `world.ready` is the device: the first session opens after the quality is decided (the benchmark of an `auto` world) and the models are loaded, and a frame drawn before draws nothing and
  // steps no clip. The motion starts once the session stands, so that its frames are the ones that move the lamp.
  for (let opened = false, i = 0; !opened; i++) {
    if (i >= OPENING_FRAMES)
      throw new Error(`the world drew nothing after ${OPENING_FRAMES} frames`)
    world.render()
    await animationFrame()
    try {
      sessionOf(world)
      opened = true
    } catch {
      /* not drawing yet */
    }
  }
  return { world, hero }
}

/** The most frames a world is given to open its session. */
const OPENING_FRAMES = 1200

const frame = async (world: World) => {
  await animationFrame()
  world.render()
}

/** The view held (`settleBy`, the proofs' own wait), then its pages resident and the image read: a lamp that is still turning static is no settled view. */
async function settle(world: World) {
  const held = await settleBy(sessionOf(world).gpuDevice, () => {
    world.render()
    return lastFrameOf(world)
  })
  if (!held) throw new Error("the view did not hold within the proofs' settle budget")
  await world.awaitPages()
  return Uint8Array.from(await sessionOf(world).capture())
}

/** One case in a fresh world: `before` sets the lamp before the first frame, `drive` acts before
 *  each move frame, `observe` reads after it, `after` acts once the motion is over; the image is
 *  read once the view holds. */
async function runCase(steps: {
  before?: (hero: Object3D) => void
  drive?: (hero: Object3D, frame: number) => void
  observe?: (hero: Object3D, frame: number) => void
  after?: (hero: Object3D) => void
}) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:180px;display:block'
  document.body.append(canvas)
  const { world, hero } = await openScene(canvas)
  try {
    steps.before?.(hero)
    for (let i = 0; i < MOVE_FRAMES; i++) {
      steps.drive?.(hero, i)
      await frame(world)
      steps.observe?.(hero, i)
    }
    steps.after?.(hero)
    return await settle(world)
  } finally {
    world.dispose()
    canvas.remove()
  }
}

/** A channel difference of up to this many levels is no difference: the images are 8-bit. */
export const TOLERANCE = 3

/** Counts the pixels of `image` that differ from `reference` by more than `TOLERANCE` levels. */
function against(image: Uint8Array, reference: Uint8Array) {
  const { maxChannelError } = compareImages(image, reference, { alpha: false })
  let differing = 0
  for (let i = 0; i < image.length; i += 4)
    if (
      Math.max(
        Math.abs(image[i] - reference[i]),
        Math.abs(image[i + 1] - reference[i + 1]),
        Math.abs(image[i + 2] - reference[i + 2]),
      ) > TOLERANCE
    )
      differing++
  return { differing, maxChannelError }
}

export type Reading = {
  errors: string[]
  /** The pose the clip stopped on, which the script and the fresh lamp take. */
  finalPose: Pose
  /** The first and the middle pose of the motion: the clip moved. */
  firstPose: Pose
  midPose: Pose
  /** Pixels of each image that differ from the fresh lamp's by more than `TOLERANCE` levels in a
   *  channel, and the greatest channel difference. */
  against: Record<'mixer' | 'script', { differing: number; maxChannelError: number }>
  drawn: { mixer: number; script: number; fresh: number }
}

export async function run(): Promise<Reading> {
  // 1. MIXER: the clip plays, each frame's pose is kept; then it stops where it stands.
  const trajectory: Pose[] = []
  let mixer: ReturnType<typeof animation.createMixer> | undefined
  const viaMixer = await runCase({
    before: (hero) => {
      mixer = animation.createMixer(hero)
      const action = mixer.clipAction(hopClip())
      action.loop = 'once'
      action.timeScale = SPEED
      action.play()
    },
    observe: (hero) => trajectory.push(poseOf(hero)),
    after: () => mixer!.stopAll(),
  })
  const finalPose = trajectory[trajectory.length - 1]
  // 2. SCRIPT: the same poses, frame by frame, written by the loop; nothing else moves.
  const viaScript = await runCase({ drive: (hero, i) => writePose(hero, trajectory[i]) })
  // 3. FRESH: the final pose set before the first frame.
  const fresh = await runCase({ before: (hero) => writePose(hero, finalPose) })
  return {
    errors: [],
    finalPose,
    firstPose: trajectory[0],
    midPose: trajectory[trajectory.length >> 1],
    against: { mixer: against(viaMixer, fresh), script: against(viaScript, fresh) },
    drawn: {
      mixer: drawnPixels(viaMixer),
      script: drawnPixels(viaScript),
      fresh: drawnPixels(fresh),
    },
  }
}
