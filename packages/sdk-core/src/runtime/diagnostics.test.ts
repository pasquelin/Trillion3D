import assert from 'node:assert/strict'
import test from 'node:test'
import { DIAGNOSTICS, type DiagnosticMode } from './diagnostics.ts'
import {
  DIAGNOSTIC_VIEWS,
  LIT_VIEWS,
} from '../../../sdk-browser/src/visibility/shader/shadeMode.ts'
import { createExplorerDiagnosticApi } from '../../../sdk-browser/src/world/api/diagnosticApi.ts'
import type { Engine } from '../../../sdk-browser/src/engine/types.ts'

const modes = Object.keys(DIAGNOSTICS) as DiagnosticMode[]

test('a view mode is available exactly when the WebGPU pipeline can show it', () => {
  // The resolve shades the normal image by default (its mode 0) and each view of its table; the
  // lit image's views are steps of the normal pipeline (`LIT_VIEWS`).
  const shown = (mode: DiagnosticMode) =>
    mode === 'beauty' || mode in DIAGNOSTIC_VIEWS || mode in LIT_VIEWS
  for (const mode of modes) assert.equal(DIAGNOSTICS[mode].available, shown(mode), mode)
  const views = [...Object.keys(DIAGNOSTIC_VIEWS), ...Object.keys(LIT_VIEWS)]
  for (const mode of views as DiagnosticMode[])
    assert.equal(DIAGNOSTICS[mode]?.available, true, `${mode} is offered`)
  for (const mode of Object.keys(LIT_VIEWS))
    assert.ok(!(mode in DIAGNOSTIC_VIEWS), `${mode}: the resolve paints no view of the lit image`)
})

test('the explorer shows each available view and refuses the others with their reason', () => {
  const shown: string[] = []
  const backend = {
    id: 'webgpu-page-raster',
    setDiagnostic: (mode: string) => shown.push(mode),
  } as unknown as Engine
  const api = createExplorerDiagnosticApi({
    check() {},
    engine: backend,
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
