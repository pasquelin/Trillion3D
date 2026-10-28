import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { createTaaLayout, type UpdateShape } from './bindingsWgsl.ts'
import { taaResolveShader } from './resolveWgsl.ts'
import { FULL_PRECISION, HALF_PRECISION } from './colorSpaceWgsl.ts'
import { historyFormatsOf, refusePackedFormats, type HistoryFormats } from './historyShape.ts'
import { GUARANTEED_STORAGE_TEXTURES } from './storageForms.ts'
import { taaExecutionOf, updateTile, type TaaExecution } from './waveOps.ts'

/** The usage of a target the temporal pass stores to by a compute pass and reads: its history and
 *  its anti-aliaser's offsets. */
export const storedTargetUsage = () =>
  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING

/** The storage textures a history update binds at most: the colour and the validity it stores to,
 *  the display layers', the half-size image's. */
const storageTextures = (filtered: boolean, half: boolean) =>
  2 + (filtered ? 2 : 0) + (half ? 1 : 0)

/** A history update compiled with or without the display layers and the half-size image, as an
 *  execution runs it: its layout, its stage and the tile a workgroup covers. */
export interface Update {
  readonly layout: GPUBindGroupLayout
  readonly stage: ReturnType<typeof preparedComputeStage>
  readonly tile: readonly [number, number]
}

/** What the updates are made for: `execution`, its 32-bit one where the device refused its 16-bit
 *  programs, or the plain one where it refused its wave programs, and the `formats` they store to. */
interface UpdateState {
  execution: TaaExecution
  formats: HistoryFormats
}

/** The update of layers (`filtered`) and half-size image (`half`) as `run` executes it, in `formats`
 *  (`TAA_UPDATE <key>`); its layout is held in `layouts` by what the layout depends on. */
function makeUpdate(
  device: GPUDevice,
  formats: HistoryFormats,
  layouts: Map<string, GPUBindGroupLayout>,
  key: string,
  filtered: boolean,
  half: boolean,
  run: TaaExecution,
): Update {
  const shape: UpdateShape = { filtered, half, color: formats.color, validity: formats.validity }
  const layoutKey = `${filtered} ${half}`
  let layout = layouts.get(layoutKey)
  if (!layout) layouts.set(layoutKey, (layout = createTaaLayout(device, shape)))
  const label = `TAA_UPDATE ${key}`
  const precision = run.half ? HALF_PRECISION : FULL_PRECISION
  return {
    layout,
    tile: updateTile(run),
    stage: preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({
        label,
        code: taaResolveShader(filtered, formats.color, {
          validity: formats.validity,
          half,
          wave: run.wave,
          precision,
        }),
      }),
      'resolve',
      undefined,
      label,
    ),
  }
}

/** The updates made so far for `state`, by layers, half-size image and execution. */
function createUpdates(device: GPUDevice, state: UpdateState) {
  const layouts = new Map<string, GPUBindGroupLayout>()
  const made = new Map<string, Update>()
  /** The updates whose off-frame compile failed: not asked again. */
  const refused = new Set<string>()
  return {
    /** The update of layers and half-size image as `run` executes it, asked (the frames held on it)
     *  when it is `state.execution`'s without layers, else compiling off the frame. */
    variant(filtered: boolean, half: boolean, run: TaaExecution) {
      const key = `${filtered} ${half} ${run.key}`
      let held = made.get(key)
      if (held || refused.has(key)) return held
      held = makeUpdate(device, state.formats, layouts, key, filtered, half, run)
      made.set(key, held)
      if (run === state.execution && !filtered) held.stage.ask()
      else
        held.stage.prepare().catch(() => {
          // Left without it, never an unhandled rejection.
          refused.add(key)
          made.delete(key)
        })
      return held
    },
    clear() {
      made.clear()
      layouts.clear()
      refused.clear()
    },
  }
}

/** What the pass falls back to where the device refuses the programs of `state`: the 32-bit ones,
 *  then the plain ones, then the core's formats (`refusePackedFormats`); none when nothing is left. */
function fallbackOf(device: GPUDevice, { execution, formats }: UpdateState) {
  if (execution.half)
    return {
      execution: taaExecutionOf(device, !!execution.wave, execution.wave?.lanes ?? 0, false),
      formats,
    }
  if (execution.wave) return { execution: taaExecutionOf(device, false, 0, false), formats }
  refusePackedFormats(device.features)
  const core = historyFormatsOf(device.features, false, device.limits)
  return core === formats ? undefined : { execution, formats: core }
}

/**
 * The pass's history updates (`taaResolveShader`, one program for every render scale and history
 * size, the display's size its ratio one), compute stages over the history in the formats the device
 * stores to (`historyFormatsOf`), as `execution` runs them (`waveOps.ts`). The one that writes the
 * half-size image — a history of the display's size — and the one without
 * it — a history larger than the display, whose resolve writes it — are asked at preparation, as every permutation of a
 * global shader is, so that the history made later (`ask`) compiles nothing. An update with the display
 * layers (`layers.ts`) — two more storage textures, which a frame without a filtering blend never
 * pays — and one of another execution — a setting changed — compile off the frame when first asked,
 * the update of `initial` (or, for the layers, none) standing in meanwhile; where the device refuses
 * the 16-bit programs of `initial` the 32-bit ones are its, where it refuses the wave programs the
 * plain ones, where it refuses those that store to the packed formats the core's formats are
 * (`refusePackedFormats`).
 */
export async function createTaaResolves(device: GPUDevice, initial: TaaExecution, packed: boolean) {
  const state: UpdateState = {
    execution: initial,
    formats: historyFormatsOf(device.features, packed, device.limits),
  }
  const updates = createUpdates(device, state)
  const fits = (filtered: boolean, half: boolean) =>
    storageTextures(filtered, half) <=
    (device.limits?.maxStorageTexturesPerShaderStage ?? GUARANTEED_STORAGE_TEXTURES)
  const halfFits = fits(false, true)
  // What a driver refuses must not take the pass with it: its 16-bit programs, its wave programs,
  // then its packed formats' ones, are replaced by the 32-bit, the plain, then the core's.
  for (;;) {
    try {
      await updates.variant(false, halfFits, state.execution)!.stage.prepare()
      break
    } catch (error) {
      updates.clear()
      const fallback = fallbackOf(device, state)
      if (!fallback) throw error
      Object.assign(state, fallback)
    }
  }
  // Both updates a history can run — the display's size writes the half-size image, a larger one's resolve writes it —, asked now with the pass, as every permutation of a global
  // shader is: the history made later compiles nothing (`ask` finds them held).
  for (const half of halfFits ? [true, false] : [false])
    updates.variant(false, half, state.execution)
  /**
   * The update as `run` executes it, with the display layers when `filtered` and the half-size
   * image when `half` (`fits`): the one of `execution` where `run`'s is not compiled yet; none for
   * the layers until theirs is.
   */
  const of = (
    filtered: boolean,
    half: boolean,
    run: TaaExecution = state.execution,
  ): Update | undefined => {
    const held = updates.variant(filtered, half, run)
    if (held?.stage.ready) return held
    if (run !== state.execution) return of(filtered, half, state.execution)
    return filtered ? undefined : held
  }
  return {
    /** Whether a device of these limits binds the storage textures of an update that resolves
     *  the layers (`filtered`) and writes the half-size image (`half`). */
    fits,
    /** Asks the update the frames of a history of the display's size (`half`: it writes the
     *  half-size image) or of a larger one run, compiled off the frame. */
    ask: (half: boolean) => void updates.variant(false, half && halfFits, state.execution),
    of,
  }
}

export type TaaResolves = Awaited<ReturnType<typeof createTaaResolves>>
