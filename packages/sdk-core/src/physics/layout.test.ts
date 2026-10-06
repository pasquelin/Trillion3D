import test from 'node:test'
import assert from 'node:assert/strict'
import * as layout from './layout.ts'
import { MAX_GEARS, TORQUE_POINTS } from './vehicleLayout.ts'
import { SOFT_VERTEX_WORDS } from './softLayout.ts'
import { joltConstant, joltEnum } from './wire.fixture.ts'

test('each error number the module answers is named as the binding names it', () => {
  assert.deepEqual(layout.MODULE_ERROR, joltEnum('binding.h', 'Error'))
})

test('each opcode is the one the module reads under its name', () => {
  const commands = joltEnum('commands.cpp', 'Op')
  for (const [name, op] of Object.entries(layout.OP)) {
    const native = name.replace(/[A-Z]/g, '_$&').toUpperCase()
    const read = commands.includes(native)
      ? commands.indexOf(native)
      : joltConstant('binding.h', native)
    assert.equal(op, read, name)
  }
})

test('each word count is the one the module reads', () => {
  for (const [file, counts] of [
    ['words.h', { ADD_WORDS: layout.ADD_WORDS, SOFT_VERTEX_WORDS }],
    ['shapes.cpp', { PART_WORDS: layout.PART_WORDS }],
    ['vehicles.cpp', { TORQUE_POINTS, MAX_GEARS }],
    [
      'binding.h',
      {
        JOINT_WORDS: layout.JOINT_WORDS,
        POSE_WORDS: layout.POSE_WORDS,
        EVENT_WORDS: layout.EVENT_WORDS,
        CHARACTER_WORDS: layout.CHARACTER_WORDS,
        CHARACTER_MOVE_WORDS: layout.CHARACTER_MOVE_WORDS,
        CHARACTER_STATE_WORDS: layout.CHARACTER_STATE_WORDS,
      },
    ],
  ] as const)
    for (const [name, words] of Object.entries(counts))
      assert.equal(words, joltConstant(file, name), `${file} ${name}`)
})
