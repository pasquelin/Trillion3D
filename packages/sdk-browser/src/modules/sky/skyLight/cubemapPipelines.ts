import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { COPY_CODE, COPY_ENTRY, COPY_LAYOUT, COPY_SCENE_ENTRY } from './copyWgsl.ts'
import { askedPipelines } from './askedPipelines.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'

const FRAGMENT = 2

/** The bind group layouts of the cubemap's passes. */
function cubemapLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    /** The host's cube, read bilinearly. */
    source: layout([
      computeTextureEntry(0, 'float', 'cube', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
    ]),
    /** The lit image of the scene drawn for a face, read bilinearly. */
    scene: layout([
      computeTextureEntry(2, 'float', '2d', FRAGMENT),
      computeSamplerEntry(3, 'filtering', FRAGMENT),
    ]),
    /** The copy's block, one slot to a face, read at a dynamic offset. */
    block: layout([
      computeUniformEntry(
        0,
        { hasDynamicOffset: true, minBindingSize: COPY_LAYOUT.words * 4 },
        FRAGMENT,
      ),
    ]),
  }
}

/**
 * THE LAYOUTS AND PIPELINES OF A SPECIFIED CUBEMAP AND OF A CAPTURED SCENE, made when the first one
 * is captured, not before: the copy of the host's cube into the faces of the captured cube
 * (`copyFaceMain`) and the copy of the scene's lit image into a face (`copySceneFaceMain`). Nothing
 * of them is compiled by a light that captures its sky in real time.
 */
export function createCubemapPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const layouts = cubemapLayouts(device)
  const { draw } = askedPipelines(device, failed)
  const copyModule = device.createShaderModule({
    label: 'Trillion3D sky light cubemap copy',
    code: COPY_CODE,
  })
  const pipelines = {
    copy: draw(
      copyModule,
      [layouts.source, layouts.block],
      COPY_ENTRY,
      { format: SKY_LIGHT_CUBE_FORMAT },
      'Trillion3D sky light cubemap copy',
    ),
    copyScene: draw(
      copyModule,
      [layouts.scene, layouts.block],
      COPY_SCENE_ENTRY,
      { format: SKY_LIGHT_CUBE_FORMAT },
      'Trillion3D sky light scene copy',
    ),
  }
  return {
    layouts,
    pipelines,
    /** Whether the copy of a specified cubemap is compiled. */
    ready: () => pipelines.copy.ready,
    /** Whether the copy of a scene's lit image is compiled. */
    sceneReady: () => pipelines.copyScene.ready,
  }
}

/** What `createCubemapPipelines` made. */
export type CubemapPipelines = ReturnType<typeof createCubemapPipelines>
