import test from 'node:test'
import assert from 'node:assert/strict'
import { windowsShim } from './fixture.ts'

// Behaviour: on Windows the proof runs a package's binary through its `.cmd` shim, which Node
// starts only through the shell; elsewhere, and for any other program, the command is unchanged.
test('a package binary runs through its .cmd shim on Windows alone', () => {
  assert.equal(
    windowsShim('D:\\a\\t\\node_modules\\.bin\\tsc', 'win32'),
    'D:\\a\\t\\node_modules\\.bin\\tsc.cmd',
  )
  assert.equal(
    windowsShim('D:\\a\\t/node_modules/.bin/esbuild', 'win32'),
    'D:\\a\\t/node_modules/.bin/esbuild.cmd',
  )
  assert.equal(windowsShim('pnpm.cmd', 'win32'), 'pnpm.cmd')
  assert.equal(windowsShim('C:\\node\\node.exe', 'win32'), 'C:\\node\\node.exe')
  assert.equal(windowsShim('/r/node_modules/.bin/tsc', 'linux'), '/r/node_modules/.bin/tsc')
})
