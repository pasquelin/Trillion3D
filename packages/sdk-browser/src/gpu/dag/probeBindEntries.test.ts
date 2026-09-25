// The GPU probes run only in the measurer's browser, so this Node test holds their bind groups
// to the engine's (#20): the page gets `namedBufferEntries` itself, and no probe, oracle or light
// cut lays its buffers out by position next to `DAG_BINDING` / `EXPAND_BINDING`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { DAG_BINDING } from './shader/bindings.ts';
import { EXPAND_BINDING } from '../../webgpu/blend/expandBindings.ts';
import { PAGE_INIT_SCRIPT } from '../../../../../tests/browser/probes/pageWebgpu.ts';

/** `namedBufferEntries` as the page sees it: installed by the init script, with no module scope. */
function pageBuilder() {
  const page: { namedBufferEntries?: typeof globalThis.namedBufferEntries } = {};
  runInNewContext(PAGE_INIT_SCRIPT, { globalThis: page });
  assert.equal(typeof page.namedBufferEntries, 'function', 'the page holds namedBufferEntries');
  return page.namedBufferEntries!;
}

const KERNELS: [string, Record<string, number>][] = [
  ['selection', DAG_BINDING],
  ['expansion', EXPAND_BINDING],
];
for (const [kernel, bindings] of KERNELS) {
  test(`the page lays each ${kernel} buffer at its shader name's binding`, () => {
    // Listed in reverse: the binding must come from the name, never from the listing order.
    const names = Object.keys(bindings).reverse();
    // A stand-in per buffer that carries its own name, so each entry says which buffer it holds.
    const buffers = Object.fromEntries(names.map((name) => [name, { buffer: name }]));
    const entries = pageBuilder()(bindings, buffers as unknown as Record<string, GPUBufferBinding>);
    assert.equal(entries.length, names.length);
    for (const { binding, resource } of entries) {
      const name = (resource as unknown as { buffer: string }).buffer;
      assert.equal(binding, bindings[name], name);
    }
  });
}

// The two probes, the cut oracle whose frozen descent still binds the shipped group 0, and the
// light cut, which binds the selection kernel's group 0 for its own views.
const BUILDERS = [
  '../../../../../tests/browser/probes/selectionKernelGpu.ts',
  '../../../../../tests/browser/probes/scatterKernelGpu.ts',
  '../../../../../bench/oracles/browser/cut-dispatches.ts',
  './lightCut.ts',
];
for (const probe of BUILDERS) {
  test(`${probe} builds its bind group through namedBufferEntries, not by position`, () => {
    const source = readFileSync(new URL(probe, import.meta.url), 'utf8');
    assert.match(source, /entries: (globalThis\.)?namedBufferEntries\(/);
    assert.doesNotMatch(source, /binding: \w+ \+ \d/, 'a binding computed from an index');
    assert.doesNotMatch(source, /\.map\(\(\w+, binding\)/, 'a binding taken from a list index');
    assert.doesNotMatch(source, /binding: \d/, 'a binding written as a number');
  });
}
