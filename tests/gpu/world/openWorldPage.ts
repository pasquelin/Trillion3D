// Page of the open-world proof: a real world runtime on Dawn (`createWorld`), opened through
// `buildWorldSource` on a generated scene — loaded models, batches of one resource, a blended
// batch, a deformed batch, meshes linked under a moved parent — and the image of fixed frames, each
// read back as 8-bit RGBA and digested. The digests are the golden set the proof compares with
// (`openWorld.golden.json`).
import { createHash } from 'node:crypto'
import { createWorld } from '../../../packages/sdk-browser/src/world/core/world.ts'
import {
  lastFrameOf,
  sessionOf,
} from '../../../packages/sdk-browser/src/world/core/worldSession.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/index.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import type { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts'
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import { animationFrame } from '../kit/onDawn.ts'
import { drawnPixels } from '../kit/sceneImageProof.ts'
import { coplanarModel } from './generatedModels.ts'

/** The camera of each frame: where it stands and what it looks at. */
const FRAMES = [
  { eye: [0, 7, 14], at: [0, 0, 0] },
  { eye: [-9, 5, 9], at: [0, 0, 0] },
  { eye: [9, 12, 3], at: [1, 0, 0] },
] as const
const SETTLE_FRAMES = 160

/** The compiled models the world loads: coplanar fixtures, each compiled once by the native compiler. */
const models = () => ['three-stack', 'blend-overlay', 'partial-overlap'].map(coplanarModel)

/** A seeded stream in [0, 1): the scene is the same on every run. */
function stream(seed: number) {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

/** The batches: many meshes of one resource each, so rows. */
function populate(world: ReturnType<typeof createWorld>) {
  const random = stream(1521)
  const { scene } = world
  scene.add(
    light.ambient({ intensity: 0.6 }),
    light.directional({ intensity: 2, position: [4, 9, 6] }),
  )
  const rock = geometry.sphere(0.5, 16, 12)
  const paint = (color: number) => material.meshStandard({ color, roughness: 0.7 })
  const scatter = (
    shape: typeof rock,
    paintOf: ReturnType<typeof paint>,
    count: number,
    y: number,
  ) => {
    const placed: Mesh[] = []
    for (let i = 0; i < count; i++) {
      const mesh = object.mesh(shape, paintOf)
      mesh.position.set((random() - 0.5) * 14, y, (random() - 0.5) * 8)
      mesh.scale.setScalar(0.6 + random() * 0.8)
      scene.add(mesh)
      placed.push(mesh)
    }
    return placed
  }
  scatter(rock, paint(0xb04a3a), 24, 0.5)
  scatter(geometry.box(0.8, 0.8, 0.8), paint(0x3a7ab0), 16, 0.4)
  // A blended batch: one resource, a surface that blends.
  scatter(
    geometry.sphere(0.6, 12, 8),
    material.meshStandard({ color: 0x40c070, transparent: true, opacity: 0.5 }),
    8,
    1.2,
  )
  // A deformed batch: one morphing sheet, drawn at several places.
  const sheet = geometry.plane(1.6, 1.6, 8, 8)
  const position = sheet.getAttribute('position')!
  const lift = new Float32Array(position.count * 3)
  for (let v = 0; v < position.count; v++) lift[v * 3 + 2] = Math.sin(v) * 0.4
  sheet.morphTargetsRelative = true
  sheet.morphAttributes.position = [new BufferAttribute(lift, 3)]
  for (const mesh of scatter(sheet, paint(0xd0b040), 6, 0.1)) {
    mesh.rotation.x = -HALF_PI
    mesh.morphTargetInfluences = [0.8]
  }
  // Meshes linked under a moved parent.
  const parent = object.group()
  parent.rotation.y = 0.5
  parent.position.set(0, 0, -2)
  for (let i = 0; i < 5; i++) {
    const child = object.mesh(geometry.box(0.6, 1.2, 0.6), paint(0x9a50c0))
    child.position.set(i - 2, 0.6, 0)
    parent.add(child)
  }
  scene.add(parent)
}

async function held(world: ReturnType<typeof createWorld>) {
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    await animationFrame()
    world.render()
    if (lastFrameOf(world)?.frameHeld) return true
  }
  return false
}

export async function run() {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:240px;display:block'
  document.body.append(canvas)
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
  })
  await world.ready
  try {
    populate(world)
    const placed = await Promise.all(models().map((url) => world.scene.load(url)))
    placed.forEach((model, i) => {
      model.position.set((i - 1) * 6, 0, 5)
      model.scale.setScalar(0.15)
    })
    const hashes: string[] = [],
      drawn: number[] = [],
      unheld: number[] = []
    for (const [index, { eye, at }] of FRAMES.entries()) {
      world.camera.position.set(eye[0], eye[1], eye[2])
      world.camera.lookAt(at[0], at[1], at[2])
      world.camera.updateMatrixWorld(true)
      await world.awaitPages()
      if (!(await held(world))) unheld.push(index)
      const pixels = await sessionOf(world).capture()
      hashes.push(createHash('sha256').update(pixels).digest('hex'))
      drawn.push(drawnPixels(pixels))
    }
    return { hashes, drawn, unheld, reopens: world.diagnostic.sessions }
  } finally {
    world.dispose()
    canvas.remove()
  }
}
