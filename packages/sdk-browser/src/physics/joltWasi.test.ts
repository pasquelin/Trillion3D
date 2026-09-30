import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { diagnosticWrite } from './joltWasi.ts';

test('WASI diagnostics join UTF-8 split across iovecs and report byte counts', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const bytes = new Uint8Array(memory.buffer),
    view = new DataView(memory.buffer);
  const encoded = new TextEncoder().encode('café 🌊\n');
  bytes.set(encoded, 64);
  // Split inside both multibyte characters, including an empty iovec.
  for (const [i, start, length] of [
    [0, 64, 4],
    [1, 68, 0],
    [2, 68, 3],
    [3, 71, 4],
  ]) {
    view.setUint32(i * 8, start, true);
    view.setUint32(i * 8 + 4, length, true);
  }
  const stdout = mock.method(console, 'log', () => {});
  const stderr = mock.method(console, 'error', () => {});
  try {
    const write = diagnosticWrite(memory);
    assert.equal(write(1, 0, 4, 40), 0);
    assert.equal(view.getUint32(40, true), encoded.length);
    assert.deepEqual(stdout.mock.calls[0].arguments, ['café 🌊']);
    assert.equal(stderr.mock.callCount(), 0);
    assert.equal(write(2, 0, 4, 40), 0);
    assert.deepEqual(stderr.mock.calls[0].arguments, ['café 🌊']);
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
  }
});

test('WASI diagnostics reject bad descriptors and memory without partial output', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const write = diagnosticWrite(memory),
    view = new DataView(memory.buffer);
  const output = mock.method(console, 'error', () => {});
  view.setUint32(32, 123, true);
  try {
    assert.equal(write(3, 0, 0, 32), 8);
    for (const args of [
      [-1, 1, 32],
      [65532, 1, 32],
      [0, -1, 32],
      [0, 0, 65534],
    ])
      assert.equal(write(2, args[0], args[1], args[2]), 21);
    view.setUint32(0, 65536, true);
    view.setUint32(4, 1, true);
    assert.equal(write(2, 0, 1, 32), 21);
    assert.equal(view.getUint32(32, true), 123);
    assert.equal(output.mock.callCount(), 0);
    memory.grow(1);
    assert.equal(write(2, 0, 0, 65536), 0, 'reads the current memory after growth');
    assert.equal(new DataView(memory.buffer).getUint32(65536, true), 0);
    assert.equal(output.mock.callCount(), 0, 'zero-byte writes do not emit a line');
  } finally {
    output.mock.restore();
  }
});
