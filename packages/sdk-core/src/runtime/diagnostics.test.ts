import assert from 'node:assert/strict'
import test from 'node:test'
import { DIAGNOSTICS, type DiagnosticMode } from './diagnostics.ts'
import { SHADE_MODE } from '../../../sdk-browser/src/visibility/shader/shadeMode.ts'
import { createExplorerDiagnosticApi } from '../../../sdk-browser/src/world/api/diagnosticApi.ts'
import type { RenderBackend } from '../../../sdk-browser/src/backend/types.ts'

const modes = Object.keys(DIAGNOSTICS) as DiagnosticMode[]

test('a view mode is available exactly when the WebGPU visibility resolve can shade it', () => {
  // The resolve shades the normal image by default (its mode 0) and each view of its table.
  for (const mode of modes)
    assert.equal(DIAGNOSTICS[mode].available, mode === 'beauty' || mode in SHADE_MODE, mode)
  for (const mode of Object.keys(SHADE_MODE) as DiagnosticMode[])
    assert.equal(DIAGNOSTICS[mode]?.available, true, `${mode} is offered`)
})

test('the explorer shows each available view and refuses the others with their reason', () => {
  const shown: string[] = []
  const backend = {
    id: 'webgpu-page-raster',
    setDiagnostic: (mode: string) => shown.push(mode),
  } as unknown as RenderBackend
  const api = createExplorerDiagnosticApi({
    check() {},
    active: () => backend,
    backends: [backend],
    beautyMaterials: new Map(),
    overlays: [],
    setMode() {},
  })
  for (const mode of modes) {
    const { available, reason } = DIAGNOSTICS[mode]
    assert.notEqual(reason.trim(), '', `${mode} says why in words`)
    if (available) api.setDiagnostic(mode)
    else assert.throws(() => api.setDiagnostic(mode), { message: reason })
  }
  assert.deepEqual(
    shown,
    modes.filter((mode) => DIAGNOSTICS[mode].available),
  )
})
