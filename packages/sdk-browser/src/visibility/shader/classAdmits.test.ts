// S7: the material depth pass is gone. Each class's fragment stage rejects, before any write, the
// pixels the depth's `equal` test used to refuse it: the background, a page past the table, another
// class (`classAdmits`). The same pixels are kept, so every texel is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MATERIAL_CLASS_KEYS, MATERIAL_CLASS_WGSL } from './materialClass.ts'
import { SHADE_SHADER } from '../buffer.ts'
import { DIAGNOSTIC_SHADE_WGSL } from '../../diagnostic/gpuGeometry.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'

test("a class's reject keeps exactly the pixels the material depth's equal test kept", () => {
  // The removed pass, mirrored in u32 and f32: each pixel's class plus one over 16384 as a depth,
  // 0 on the background and past the table, tested equal against `(KEY + 1) / 16384`.
  const pages = [{ materialClass: 0 }, { materialClass: 8191 }, { materialClass: 5 }]
  const pageCount = pages.length
  const classOf = (id: number) => {
    const page = ((id >>> 8) - 1) >>> 0
    return id === 0 || page >= pageCount ? 0 : pages[page].materialClass + 1
  }
  const depthKept = (id: number, key: number) =>
    Math.fround(classOf(id) / 16384) === Math.fround((key + 1) / 16384)
  // The background, a wrapped index, each page and its last triangle, the first page past the
  // table and one far past it.
  const ids = [0, 1, 255, 256, 511, 512, 767, 768, 1023, 1024, 0xffffff00]
  for (const key of [0, 5, 8191, MATERIAL_CLASS_KEYS - 2]) {
    const scope = { uni: { pageCount }, pages, SINGLE_CLASS: false, CLASS_KEY: key }
    const { classAdmits } = shaderRun<{ classAdmits: (id: number) => boolean }>(
      MATERIAL_CLASS_WGSL,
      ['classAdmits'],
      scope,
    )
    for (const id of ids) assert.equal(classAdmits(id), depthKept(id, key), `key ${key}, id ${id}`)
    // The image's only class: every pixel of a page, whatever the page says its class is.
    const single = shaderRun<{ classAdmits: (id: number) => boolean }>(
      MATERIAL_CLASS_WGSL,
      ['classAdmits'],
      { ...scope, SINGLE_CLASS: true },
    )
    for (const id of ids) assert.equal(single.classAdmits(id), classOf(id) !== 0, `single ${id}`)
  }
  assert.ok(depthKept(512, 8191) && depthKept(768, 5) && !depthKept(768, 4))
})

test('every resolve stage rejects with the class test before any write', () => {
  for (const [source, name] of [
    [SHADE_SHADER, 'shade_fs'],
    [DIAGNOSTIC_SHADE_WGSL, 'shade_plat_fs'],
    [DIAGNOSTIC_SHADE_WGSL, 'shade_ids_fs'],
  ]) {
    const body = source.slice(source.indexOf(`fn ${name}(`))
    const reject = body.indexOf('if(!classAdmits(')
    assert.ok(reject > 0, `${name} asks its class`)
    for (const write of ['store', 'return']) {
      const at = body.indexOf(write)
      assert.ok(at < 0 || at > reject, `${name}: no ${write} before the reject`)
    }
  }
  assert.doesNotMatch(SHADE_SHADER, /material_depth_fs|frag_depth|CLASS_DEPTH/)
})
