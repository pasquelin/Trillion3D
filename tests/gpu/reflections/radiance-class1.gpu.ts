// The radiance pyramid's level 0 is the lit image itself, two HDR targets taking turns, where it was
// a copy of it (`radianceClass1Page.ts`): class 1, no 8-bit pixel changes.
//
//  - The engine's read of level 0 is the copy's read, bit for bit, at every tap over generated lit
//    images, their drawn border and past it included.
//  - Three still images of each reflective family (mirror, rough, coated rough) give one reflection
//    target, bit for bit, the HDR targets taking turns between them.
//  - Against the images of the base branch: run once with `TRILLION3D_CLASS1_WRITE=1` on the branch
//    before the change (this file, its page and `glassPage.ts` copied there; `rig.ts` keeps its
//    interface), which
//    writes the reference under `.mesure/out/gpu-proofs/radiance-class1/`; then here, every family's
//    reflection target and every glass image is the reference's to the 8-bit value.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/radiance-class1.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { measureOutput } from '../../../bench/core/paths.ts'
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { Class1Reading } from './radianceClass1Page.ts'

const REFERENCE = measureOutput('gpu-proofs', 'radiance-class1', 'reference.json')

/** A half-float word as the 8-bit value a display of it shows: its value within one, of 255. */
const byte = (word: number) => Math.round(Math.min(Math.max(fromHalf(word), 0), 1) * 255)

test('level 0 read in place is the copy it replaces, and every family is the base branch to the 8-bit value', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'radianceClass1Page.ts'),
    'radianceClass1',
  )) as typeof import('./radianceClass1Page.ts')
  const result = (await runOnDawn(page.run, undefined)) as Partial<Class1Reading> & {
    error?: string
    errors?: string[]
  }
  assert.equal(result.error, undefined, result.error)
  assert.deepEqual(result.errors, [])
  if (process.env.TRILLION3D_CLASS1_WRITE === '1') {
    mkdirSync(dirname(REFERENCE), { recursive: true })
    const families = Object.fromEntries(
      Object.entries(result.families!).map(([name, targets]) => [name, targets.at(-1)]),
    )
    writeFileSync(REFERENCE, JSON.stringify({ families, glass: result.glass }))
    console.log(`reference written: ${REFERENCE}`)
    return
  }
  assert.equal(result.level0!.length, 3, 'level 0 read in place on every lit image')
  for (const read of result.level0!) {
    assert.equal(read.differ, 0, `${read.size} drawn ${read.drawn}: ${read.differ} words differ`)
    assert.ok(read.nonzero > 0, `${read.size}: the reads saw the image`)
  }
  for (const [name, targets] of Object.entries(result.families!)) {
    assert.deepEqual(targets[1], targets[0], `${name}: the second image, the other HDR target`)
    assert.deepEqual(targets[2], targets[0], `${name}: the third, the first target again`)
  }
  // The base branch's images, where its run wrote them: else the proofs above stand alone.
  if (!existsSync(REFERENCE)) {
    console.log(`no base reference at ${REFERENCE}: the 8-bit comparison is not made`)
    return
  }
  const reference = JSON.parse(readFileSync(REFERENCE, 'utf8')) as {
    families: Record<string, number[]>
    glass: Class1Reading['glass']
  }
  for (const [name, targets] of Object.entries(result.families!)) {
    const now = targets.at(-1)!,
      before = reference.families[name]
    assert.equal(now.length, before.length, name)
    let bits = 0,
      bytes = 0
    for (let i = 0; i < now.length; i++) {
      if (now[i] !== before[i]) bits++
      if (byte(now[i]) !== byte(before[i])) bytes++
    }
    console.log(`${name}: ${bits} half words differ, ${bytes} 8-bit values`)
    assert.equal(bytes, 0, `${name}: ${bytes} 8-bit values differ`)
  }
  for (const [kind, image] of Object.entries(result.glass!)) {
    assert.ok(image.held, `${kind}: held`)
    const before = reference.glass[kind]
    let bytes = 0
    for (let i = 0; i < image.pixels.length; i++) if (image.pixels[i] !== before.pixels[i]) bytes++
    console.log(`glass ${kind}: ${bytes} bytes differ`)
    assert.equal(bytes, 0, `glass ${kind}: ${bytes} bytes differ`)
  }
})
