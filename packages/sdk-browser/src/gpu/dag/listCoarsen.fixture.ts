// A generated world cut on a fake device whose readbacks hold what the kernels cut: each maps the
// kernels' oracle (`oracle/oracle.fixture.ts`) under the threshold the cut last wrote to its
// uniforms, so the factor a cut runs at decides the lists it lists.
import * as G from '../../host/graph/graph.fixture.ts'
import { asHostLibrary } from '../../host/resources.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { packDagSelection } from './pack.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { stagedOutputBytes } from './layout.ts'
import { viewWord } from './viewLayout.ts'
import { writtenReadbacks } from './differenceRig.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { SelectionUniforms } from '../core/selection.ts'

const cam = G.perspectiveCamera(55, 16 / 9, 0.1, 2000)

/** Sixteen pyramids of eight detail levels (`scenePages`) on a grid, and the view of a camera at
 *  `z` before them, the placements' worlds taken at its eye. */
export function world() {
  const pages = scenePages(256, 8)
  const worlds = Array.from({ length: 16 }, () => new G.Matrix4())
  const roots = sceneRoots(pages, worlds)
  worlds.forEach((m, w) =>
    asHostLibrary<G.Matrix4>(m).makeTranslation((w % 4) * 6.5 - 9.75, (w >> 2) * 6.5 - 9.75, 0),
  )
  const dag = packDagSelection(roots)
  const view = (z: number): SelectionUniforms => {
    cam.position.set(0, 0, z)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const uniforms = cameraSelectionUniforms(engineCamera(cam), 1, [1280, 720])
    packedWorldsToRenderOrigin(dag, roots, uniforms.cameraWorld!)
    return uniforms
  }
  /** The oracle's lists under `uniforms` at threshold `pixelError`. */
  const lists = (uniforms: SelectionUniforms, pixelError = uniforms.pixelError) => {
    const cut = evaluateDagSelectionKernel(dag, { ...uniforms, pixelError })
    return { asked: [...cut.pageIds], drawn: [...(cut.drawablePageIds ?? [])] }
  }
  return { dag, view, lists }
}

/** `world()` cut on a device whose one binding holds `deviceCap` ranks of the readout. */
export async function worldCut(deviceCap: number) {
  const scene = world()
  const fake = fakeDevice({
    limits: {
      maxStorageBufferBindingSize: stagedOutputBytes(deviceCap),
      maxStorageBuffersPerShaderStage: 1024,
    },
  })
  // The tables, once made: the readbacks read the list in place and the uniforms written last.
  const held = {} as { resources: NonNullable<Awaited<ReturnType<typeof createDagResources>>> }
  let viewed!: SelectionUniforms
  const threshold = () => held.resources.uniformData[viewWord('pixelError')]
  writtenReadbacks(fake.device, () => ({
    cap: held.resources.listCap,
    cut: scene.lists(viewed, threshold()),
  }))
  const resources = await createDagResources(fake.device, scene.dag, null)
  if (!resources) throw new Error('the fake device refused the tables')
  held.resources = resources
  const selection = createDagRuntime(resources)
  /** One image under `uniforms` and its drain. */
  const frame = async (uniforms: SelectionUniforms) => {
    viewed = uniforms
    selection.dispatch(uniforms)
    await selection.flush()
    return selection.peek()
  }
  return { ...scene, fake, resources, selection, frame, threshold }
}
