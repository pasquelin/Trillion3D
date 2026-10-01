import assert from 'node:assert/strict';
import test from 'node:test';
import { isVendoredDependency, repositoryFiles } from './repository-files.ts';

test('only the frozen dependencies are outside maintained-source checks; their patch records remain checked', () => {
  for (const name of ['cadmpeg-codec-rhino', 'serde-json-legacy']) {
    const root = `packages/asset-compiler-rust/vendor/${name}/`;
    assert.equal(isVendoredDependency(`${root}src/lib.rs`), true);
    assert.equal(isVendoredDependency(`${root}PATCH.md`), false);
  }
  assert.equal(
    isVendoredDependency('packages/asset-compiler-rust/src/plugins/scene/rhino.rs'),
    false,
  );
  assert.equal(
    isVendoredDependency('packages/asset-compiler-rust/vendor/another/src/lib.rs'),
    false,
  );
  const files = repositoryFiles()!;
  assert.ok(files.includes('packages/asset-compiler-rust/src/plugins/scene/rhino.rs'));
  for (const name of ['cadmpeg-codec-rhino', 'serde-json-legacy'])
    assert.ok(files.includes(`packages/asset-compiler-rust/vendor/${name}/PATCH.md`));
  assert.ok(
    !files.includes('packages/asset-compiler-rust/vendor/cadmpeg-codec-rhino/src/container.rs'),
  );
});
