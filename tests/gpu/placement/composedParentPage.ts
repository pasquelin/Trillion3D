// Page of the composed-parent proof: a world draws a group of meshes whose placements the session
// composes on the GPU under their parent; the parent turns, scales or moves while the session
// runs, and the image is the one of a world opened with the parent already there. What the GPU
// composes — the worlds, the stretch the level of detail is judged by, the corners the occlusion
// test projects, the boxes, the shadows' levels of detail — must be what a full write would hold.
// Generated scenes: boxes in a grid, a wall, a light; no file of the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/index.ts'
import { changed, open, type World } from '../world/appendProof.ts'

const crate = geometry.box(0.8, 0.8, 0.8)
const ball = geometry.sphere(0.5, 64, 48)
const slab = geometry.box(6, 3, 0.4)
const paints = [0xb04a3a, 0x3a7ab0, 0x7ab03a].map((color) =>
  material.meshStandard({ color, roughness: 0.7 }),
)

/** Where the rig stands: its position, its turn, its scale. */
type Pose = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

const AT_REST: Pose = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }

/** Writes `pose` on the rig. */
function pose(rig: ReturnType<typeof object.group>, p: Pose) {
  rig.position.set(...p.position)
  rig.rotation.set(...p.rotation)
  rig.scale.set(...p.scale)
}

/** The scene every case starts from: a rig of crates and balls in a grid, a wall across the
 *  middle of the view, and, with `shadows`, a light that casts. The rig is returned, at `at`. */
function scene(world: World, at: Pose, shadows: boolean, grid: [number, number] = [12, 6]) {
  // Detail is judged by the screen error: the stretch of a placement decides how much it draws.
  world.pixelError = 8
  if (shadows)
    world.scene.add(light.directional({ intensity: 1.5, position: [-5, 10, 4], castShadow: true }))
  const wall = object.mesh(slab, paints[1])
  wall.position.set(0, 1.5, 1.5)
  world.scene.add(wall)
  const rig = object.group()
  for (let i = 0; i < grid[0]; i++)
    for (let j = 0; j < grid[1]; j++) {
      const mesh = object.mesh(j % 2 ? ball : crate, paints[(i + j) % 3 === 0 ? 0 : 2])
      mesh.position.set((i - (grid[0] - 1) / 2) * 1.3, 0.5, -j * 1.4)
      rig.add(mesh)
    }
  pose(rig, at)
  world.scene.add(rig)
  return rig
}

/** A world whose rig moves from `from` to `to` while it runs, against a world opened with it at
 *  `to`: the images, and the sessions the first was opened with. The rig moves once first, to
 *  `from`'s neighbour: that move writes its rows and links them to their parent, the next ones are
 *  the GPU's. */
async function moved(from: Pose, to: Pose, shadows = false, grid?: [number, number]) {
  const grown = open()
  try {
    await grown.world.ready
    const rig = scene(grown.world, AT_REST, shadows, grid)
    const first = await changed(grown.world, '')
    pose(rig, from)
    // The rig drawn where it starts, composed under its parent from here on.
    const before = await changed(grown.world, first)
    const sessions = grown.world.diagnostic.sessions
    pose(rig, to)
    const after = await changed(grown.world, before)
    const reference = open()
    try {
      await reference.world.ready
      scene(reference.world, to, shadows, grid)
      const opened = await changed(reference.world, '')
      return { before, after, opened, sessions: [sessions, grown.world.diagnostic.sessions] }
    } finally {
      reference.close()
    }
  } finally {
    grown.close()
  }
}

/** The rig turns and moves. */
export const runTurn = () =>
  moved(
    { position: [0, 0.3, 0], rotation: [0, 0.2, 0], scale: [1, 1, 1] },
    { position: [2, 0.5, -1], rotation: [0, 0.6, 0], scale: [1, 1, 1] },
  )

/** The rig is scaled, uniformly: the stretch the detail is judged by, the boxes, the corners. */
export const runScale = () =>
  moved(
    { position: [0, 0.3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { position: [0, 0, -2], rotation: [0, 0, 0], scale: [5, 5, 5] },
  )

/** The rig is scaled unevenly and turned: the stretch is the largest singular value. */
export const runShear = () =>
  moved(
    { position: [0, 0.3, 0], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1] },
    { position: [0, 0, -1], rotation: [0.3, 0.8, 0.1], scale: [3, 0.5, 1.6] },
  )

/** The rig moves behind the wall and out again: what the wall hides is judged by the corners the
 *  composition writes. */
export const runBehind = () =>
  moved(
    { position: [0, 0, -1], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { position: [0, 1, -6], rotation: [0, 0.4, 0], scale: [1.4, 1.4, 1.4] },
  )

/** A light casts: the shadows' levels of detail of rows the rig composes follow its scale. */
export const runShadows = () =>
  moved(
    { position: [0, 0.3, 0], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1] },
    { position: [1, 0, -1], rotation: [0, 0.5, 0], scale: [2, 2, 2] },
    true,
  )

/** A dense rig stands far from the view, outside every level of the sun's clipmap, and its parent
 *  moves it into them in one move: the rows the shadow raster is sized from — the CPU copy of their
 *  spheres — are those of the pose the GPU composed (`placement/composedSpheres.ts`), so every
 *  (row, page) pair is rendered, none dropped: the shadows are the world opened there. */
export const runSunFar = () =>
  moved(
    { position: [900, 0.3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { position: [0, 0, -2], rotation: [0, 0.3, 0], scale: [1, 1, 1] },
    true,
    [24, 24],
  )
