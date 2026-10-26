// A flat-shaded page, each triangle under its own normal, stores its positions once: the encoder
// and the JavaScript decoder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodePage } from './encodePage.fixture.ts'
import { decodeGeometryPage } from './geometryPage.ts'
import { flatMesh } from './positions.fixture.ts'

test('a flat-shaded page stores fewer positions than vertices', () => {
  const mesh = flatMesh()
  const { data } = encodePage(mesh.indices, mesh.attributes, 4)
  // Header word 20 counts the positions stored (`position_count`, `lib.rs`); the link rule itself,
  // and the refusal of a link past them, are the decoder's (`positions/tests.rs`).
  const positionCount = new DataView(data.buffer, data.byteOffset).getUint32(20 * 4, true)
  const { vertexCount } = decodeGeometryPage(data as Uint8Array)
  assert.ok(positionCount < vertexCount, `${positionCount} positions for ${vertexCount} vertices`)
})
