// The frozen descent runs inside the shipped shader: a shipped stage calling a function the frozen
// text owns reads the FROZEN layout, silently. #477: `stampUse` wrote at the frozen `queueBase(3u)`,
// zero, over the draw flags, and "same drawn pages" failed in the browser only. Pinned here, in Node.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DAG_SELECTION_SHADER_BEFORE,
  DESCENT_BEFORE,
  SHIPPED_STAGES,
} from './cut-dispatches-wgsl.ts'
import { DAG_LEVEL_WGSL } from '../../../packages/sdk-browser/src/gpu/dag/shader/levelWgsl.ts'

test('the shipped stages reach the frozen descent only through the calls it answers as they do', () => {
  const frozen = [...DESCENT_BEFORE.matchAll(/\bfn (\w+)\(/g)].map((m) => m[1])
  const stages = SHIPPED_STAGES.replace(DAG_LEVEL_WGSL, '').replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    '',
  )
  const callee = `\\b(?:${frozen.join('|')})\\(`
  const calls = [...stages.matchAll(new RegExp(`${callee}(?:[^()]|\\([^()]*\\))*\\)`, 'g'))]
  // A call nested deeper than one level escapes the text match: every callee is still counted.
  assert.equal(calls.length, stages.match(new RegExp(callee, 'g'))?.length ?? 0)
  // Each is the frozen layout's own business: `resetCounters` zeroes its counters, `drawnAppend`
  // logs a drawn page where its `dagClearDrawn` reads it, and `dagWanted` bounds its dispatch by
  // its candidate count. A call added here reads the frozen layout: take the callee from the
  // shipped descent (`BEFORE_SHIMS`) unless both layouts give it the same answer.
  // Every call site, not each distinct text: a second `candCounter()` elsewhere is a new reader too.
  assert.deepEqual(calls.map((m) => m[0]).sort(), [
    'candCounter()',
    'drawnAppend(i)',
    'resetCounters()',
  ])
})

// #1483: the shipped drawn clear moved out of the descent into the swap kernels, and the frozen
// module declared it twice — a redeclaration Dawn refused before a single frame was timed.
test('the frozen module declares each function once', () => {
  const names = [...DAG_SELECTION_SHADER_BEFORE.matchAll(/^fn (\w+)\(/gm)].map((m) => m[1])
  assert.deepEqual(
    names.filter((name, i) => names.indexOf(name) !== i),
    [],
  )
})
