/**
 * THE SUBSURFACE DEBUG VIEWS over the display image, drawn after the image is composed: the profile map (`subsurface-profiles`, `visualizeWgsl.ts`) with its title and the list of
 * the profiles, and the reading of the pixel under the debug cursor (`subsurfaceDebugPixel`, `debugPixel.ts`) written as a table. Nothing, and the passes given back, while neither is asked.
 */
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { drawScreenPass, screenPassPipeline } from '../../diagnostic/screenPass.ts'
import { createTextOverlay, TEXT_LINE } from '../../diagnostic/textOverlay.ts'
import { DEBUG_COLORS } from '../../hair/debugLines.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  defaultSkinProfile,
  type SubsurfaceProfile,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { PIXEL_FIELDS } from './debugPixel.ts'
import { subsurfaceDebugSource } from './frame.ts'
import { subsurfacePrograms } from './pipelines.ts'
import { SSS_VISUALIZE_ENTRY, SSS_VISUALIZE_WGSL } from './visualizeWgsl.ts'

const FRAGMENT = 2

const programs = oncePerDevice((device: GPUDevice) => {
  const shown = device.createBindGroupLayout({
    label: `${SUBSURFACE_PASS} visualize`,
    entries: [{ binding: 0, visibility: FRAGMENT, buffer: { type: 'uniform' } }],
  })
  return {
    shown,
    block: device.createBuffer({
      label: `${SUBSURFACE_PASS} visualize`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    pipeline: screenPassPipeline(
      device,
      `${SUBSURFACE_PASS} visualize`,
      SSS_VISUALIZE_WGSL,
      SSS_VISUALIZE_ENTRY,
      device.createPipelineLayout({
        bindGroupLayouts: [subsurfacePrograms(device).common, shown],
      }),
    ),
  }
})

/** The character a profile's number is written with: the digits, then the letters, any other a question mark. */
const profileChar = (index: number) =>
  index <= 9 ? String(index) : index <= 35 ? String.fromCharCode(55 + index) : '?'

const fixed = (v: number) => v.toFixed(1)
const triple = (c: readonly number[]) => `${fixed(c[0]!)} ${fixed(c[1]!)} ${fixed(c[2]!)}`

/** The line a profile is listed by: its number, its scattering terms, its tint and its implementation. */
const entryString = (index: number, p: SubsurfaceProfile) =>
  ` ${profileChar(index)}. SurfaceAlbedo=${triple(p.surfaceAlbedo)}, MeanFreePathColor=${triple(p.meanFreePathColor)}, ` +
  `MeanFreePathDistance=${fixed(p.meanFreePathDistance)}, WorldUnitScale=${fixed(p.worldUnitScale)}, Tint=${triple(p.tint)}, ` +
  `BoundaryColorBleeding=${triple(p.boundaryColorBleed)}, TransmissionTintColor=${triple(p.transmissionTintColor)}, ` +
  (p.implementation === 'importanceSampling' ? 'AFIS' : 'Separable')

const texts = new WeakMap<object, ReturnType<typeof createTextOverlay>>()

/** Writes the table of the pixel the debug cursor points at, from the pixel (50, 50): what the kernel found of its lighting and its recombine. */
function writePixelTable(
  text: ReturnType<typeof createTextOverlay>,
  found: Float32Array,
  at: readonly [number, number],
  alpha: boolean,
) {
  const { lines } = text
  const f = (field: number, count: number) =>
    Array.from(found.subarray(field, field + count), (v) => v.toFixed(4)).join(' ')
  const rows: [string, number][] = []
  const row = (name: string, value: string, color: number) =>
    rows.push([`${name.padEnd(18)}: ${value}`, color])
  if (found[PIXEL_FIELDS.isProfile] === 0) return
  const combined = found.subarray(PIXEL_FIELDS.combined, PIXEL_FIELDS.combined + 4)
  const luminance = 0.3 * combined[0]! + 0.59 * combined[1]! + 0.11 * combined[2]!
  const { white, silver, emerald, orange, yellow, green } = DEBUG_COLORS
  const title = (name: string) => rows.push([name, emerald])
  title('=== SSS Debug ===')
  rows.push(['', white])
  row('Coordinate', `${at[0]} ${at[1]}`, orange)
  row('Format', alpha ? 'RGBA' : 'RGB', white)
  row('CombinedColor', f(PIXEL_FIELDS.combined, 3), orange)
  row('CombinedLuminance', luminance.toFixed(4), orange)
  row('SceneColor.a', combined[3]!.toFixed(4), silver)
  rows.push(['', white])
  row('Diffuse', f(PIXEL_FIELDS.diffuse, 3), green)
  row('Specular', f(PIXEL_FIELDS.specular, 3), yellow)
  rows.push(['', white])
  title('=== Recombine ===')
  rows.push(['', white])
  row('ProfileId', String(found[PIXEL_FIELDS.profile]), orange)
  row('StoredBaseColor', f(PIXEL_FIELDS.baseColour, 3), orange)
  row('Tint', f(PIXEL_FIELDS.tint, 3), orange)
  row('LerpFactor', (1).toFixed(4), orange)
  row('SSSColor (blur)', f(PIXEL_FIELDS.scattered, 3), DEBUG_COLORS.blue)
  rows.push(['', white])
  row('SSS Diffuse', f(PIXEL_FIELDS.scatteredLight, 3), green)
  row('SSS Specular', f(PIXEL_FIELDS.specular, 3), yellow)
  row('Final', f(PIXEL_FIELDS.final, 3), white)
  rows.forEach(([line, color], i) => lines.text(line, 50, 50 + i * TEXT_LINE, color))
}

/** Gives the text pass of a runtime's subsurface debug views back. */
export function disposeSubsurfaceDebug(rt: object) {
  texts.get(rt)?.dispose()
  texts.delete(rt)
}

/** Draws the subsurface debug views over the display image of `rt`. */
export function encodeSubsurfaceDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const source = subsurfaceDebugSource(rt)
  const map = rt.run.diagnostic === 'subsurface-profiles'
  const pixel = source?.pixel?.ready && source.settings.debugPixel ? source.pixel : undefined
  if (!source || !gpu.displayView || (!map && !pixel)) return disposeSubsurfaceDebug(rt)
  let text = texts.get(rt)
  if (!text) texts.set(rt, (text = createTextOverlay(device)))
  text.begin(cam)
  if (map) {
    const made = programs(device)
    const pipeline = made.pipeline.get()
    if (pipeline) {
      device.queue.writeBuffer(made.block, 0, new Float32Array([...gpu.displaySize, 0, 0]))
      drawScreenPass(encoder, `${SUBSURFACE_PASS} visualize`, pipeline, gpu.displayView, [
        source.groups.common,
        device.createBindGroup({
          layout: made.shown,
          entries: [{ binding: 0, resource: { buffer: made.block } }],
        }),
      ])
    }
    const { white } = DEBUG_COLORS
    text.lines.text('Visualize Screen Space Subsurface Scattering', 30, 28 + TEXT_LINE, white)
    const entries = [defaultSkinProfile(), ...source.profiles]
    entries.forEach((profile, index) =>
      text.lines.text(entryString(index, profile), 30, 28 + (3 + index) * TEXT_LINE, white, 1),
    )
  }
  if (pixel) {
    writePixelTable(
      text,
      pixel.found,
      [Math.round(pixel.found[0]!), Math.round(pixel.found[1]!)],
      true,
    )
  }
  text.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}
