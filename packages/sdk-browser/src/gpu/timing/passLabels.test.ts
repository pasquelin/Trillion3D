// The GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and the profile files a span by that label alone (`../../stage/passTable.ts`).
// Every pass the engine begins is read here from the source: its descriptor, inline or declared
// before the call in the same module, opens with its label, and that label — a literal, a constant
// of a module, a template or a choice of them, or a parameter its callers fill — is a row of the
// pass table, or a virtual shadow map pass by its prefix. A new pass without a label, or with one
// the table does not name, fails this test, never the ranking nor the profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { gpuPassStageOf } from '../../stage/mapping.ts'
import { VSM_PASS_PREFIX } from '../../stage/passLabels.ts'
import { argumentSpans, descriptorsOf, modules } from './passSource.fixture.ts'
import { UNREAD, labelsOf } from './passLabelValues.fixture.ts'

/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts'

/** Whether the profile files a pass under `label`: a row of the table, or the virtual shadow
 *  maps' prefix, which a label read only in part must open with. */
const filed = (label: string) =>
  label.includes(UNREAD)
    ? label.split(UNREAD)[0].startsWith(VSM_PASS_PREFIX)
    : gpuPassStageOf(label) !== undefined

/** Every pass the engine begins: where, and the descriptors it can be (`null` unlabelled). */
const begun = [...modules]
  .filter(([file]) => file !== FORWARDER)
  .flatMap(([file, text]) =>
    [...text.matchAll(/\.begin(?:Render|Compute)Pass\(/g)].map((match) => {
      const span = argumentSpans(text, match.index + match[0].length - 1)[0]
      return {
        file,
        text,
        at: `${file}:${text.slice(0, match.index).split('\n').length}`,
        descriptors: span ? descriptorsOf(text, span, match.index) : null,
      }
    }),
  )

test('every render and compute pass the engine begins opens its descriptor with a label', () => {
  const missing = begun.filter((pass) => !pass.descriptors).map((pass) => pass.at)
  assert.ok(begun.length >= 40, `the scan reached the engine's passes (${begun.length})`)
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`')
})

test('every label a pass begins with is a row of the pass table', () => {
  const unnamed: string[] = []
  let read = 0
  for (const { file, text, at, descriptors } of begun)
    for (const open of descriptors ?? [])
      for (const label of labelsOf(file, text, open)) {
        read++
        if (!filed(label)) unnamed.push(`${at} ${label.replaceAll(UNREAD, '…')}`)
      }
  assert.ok(read >= begun.length, `every pass's label was read (${read})`)
  assert.deepEqual(unnamed, [], 'a pass the table does not name is filed under no stage')
})
