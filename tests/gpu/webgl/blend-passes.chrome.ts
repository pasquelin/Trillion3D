// The engine's WebGL2 program draws BLEND batch records as the host image needs, in Chrome: in
// their range order, which changes the overlap; a two-sided BLEND surface as a back then a front
// pass, one pass when it asks for a single one; MASK opaque past its cutoff; a raised coplanar
// layer over its base, BLEND layers included; a diagnostic mesh; nothing for a hidden source; and
// a surface it cannot draw refused by name before any pass touches the target.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './blendPassesPage.ts'

const PAGE = resolve(import.meta.dirname, 'blendPassesPage.ts')
const CLEAR = [0, 0, 255, 255]

test(
  'BLEND, MASK and coplanar layers draw in their passes on WebGL2',
  { timeout: 120_000 },
  async () => {
    const result = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute')
    console.log(JSON.stringify(result))
    assert.notDeepEqual(result.sourceOrder, result.reversedOrder, 'range order must affect overlap')
    assert.equal(result.splitSubmissions, 2, 'back and front are two submitted passes')
    assert.equal(result.singleSubmissions, 1, 'forceSinglePass submits one double-sided pass')
    assert.equal(result.maskPixel[3], 255, 'MASK remains opaque after its cutoff')
    assert.ok(result.blendPixel[2] > 0, 'BLEND preserves the blue destination')
    assert.ok(result.coplanarPixel[1] > result.coplanarPixel[0], 'the raised coplanar layer wins')
    assert.equal(result.coplanarBlendSubmissions, 3, 'the opaque base and both BLEND passes')
    assert.deepEqual(result.coplanarBlendWithoutBias, [255, 0, 0, 255])
    assert.ok(result.coplanarBlendPixel[1] > 0 && result.coplanarBlendPixel[0] < 255)
    assert.equal(result.diagnosticSubmissions, 1)
    assert.ok(result.diagnosticPixel[0] + result.diagnosticPixel[1] > 0)
    assert.equal(result.hiddenSubmissions, 0, 'a hidden source suppresses both generated passes')
    assert.deepEqual(result.hiddenPixel, CLEAR)
    assert.equal(result.sourceMutationRejected, true)
    assert.deepEqual(result.sourceRejectionPixel, CLEAR, 'refused before drawing')
    assert.equal(result.mutationRejected, true, 'a material array is refused by name')
    assert.deepEqual(result.rejectionPixel, CLEAR, 'refused before drawing')
  },
)
