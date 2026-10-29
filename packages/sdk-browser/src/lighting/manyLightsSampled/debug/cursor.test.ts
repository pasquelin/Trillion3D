import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { debugCursor } from './cursor.ts'

/** A runtime whose context sets the cursor at `x` and `y` (-1: none). */
const runtimeAt = (x: number, y: number) =>
  ({
    context: { sampledLightsDebugCursorX: x, sampledLightsDebugCursorY: y },
  }) as unknown as WebgpuPagesRuntime

test('the debug cursor is the middle of the image on an axis where none is set, and held inside it', () => {
  assert.deepEqual(debugCursor(runtimeAt(-1, -1), [1920, 1081]), [960, 540])
  assert.deepEqual(debugCursor(runtimeAt(100, 10), [1920, 1081]), [100, 10])
  assert.deepEqual(debugCursor(runtimeAt(5000, 3), [1920, 0]), [1919, 0])
})
