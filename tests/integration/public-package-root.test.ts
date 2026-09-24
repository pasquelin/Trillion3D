import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '../..');

function diagnostics(file: string, options: ts.CompilerOptions): string[] {
  const program = ts.createProgram([isAbsolute(file) ? file : resolve(ROOT, file)], {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    ...options,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

test('package metadata exposes one environment-aware root', async () => {
  const packageJson = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'trillion3d');
  assert.equal(packageJson.version, '0.2.0');
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.bin['trillion3d-compile'], './dist/sdk-node/src/cli/cli.mjs');
  assert.deepEqual(Object.keys(packageJson.exports), ['.', './package.json']);
  assert.deepEqual(Object.keys(packageJson.exports['.']), [
    'browser',
    'node',
    'types',
    'import',
    'default',
  ]);
  assert.equal(packageJson.exports['.'].default, './dist/sdk/index.js');
  assert.equal(packageJson.peerDependencies.three, '^0.174.0');
  assert.equal(packageJson.scripts.preinstall, undefined);
});

test('NodeNext, browser Bundler, and the safe default resolve matching declarations', () => {
  assert.deepEqual(
    diagnostics('tests/fixtures/publicNode.mts', {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    }),
    [],
  );
  assert.deepEqual(
    diagnostics('tests/fixtures/publicBrowser.ts', {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      customConditions: ['browser'],
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
      types: ['@webgpu/types'],
    }),
    [],
  );
  assert.deepEqual(
    diagnostics('tests/fixtures/publicCommon.ts', {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2023.d.ts'],
      types: ['node'],
    }),
    [],
  );
});

test('type-only imports leave no runtime package import', async () => {
  const source = await readFile(resolve(ROOT, 'tests/fixtures/publicTypesOnly.ts'), 'utf8');
  const emitted = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  assert.doesNotMatch(emitted, /trillion3d/);
});

test('the browser condition imports rendering and common bindings without initialization', () => {
  const probe = `
    const sdk = await import('trillion3d');
    if (typeof sdk.createWorld !== 'function') throw new Error('missing createWorld');
    if ('openMeasuredWorld' in sdk) throw new Error('the measurement entry leaked into the package');
    if (typeof sdk.hierarchyUpdateBatch !== 'function') throw new Error('missing common maths');
    if ('prepare' in sdk) throw new Error('Node API leaked into browser');
  `;
  execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', probe], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

test('a packed installation resolves Node and browser runtime and declarations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trillion3d-contract-'));
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', directory], {
      cwd: ROOT,
      env: { ...process.env, CI: 'true' },
      stdio: 'pipe',
    });
    const tarball = (await readdir(directory)).find((file) => file.endsWith('.tgz'));
    assert.ok(tarball);
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          meshoptimizer: `link:${resolve(ROOT, 'node_modules/meshoptimizer')}`,
          trillion3d: `file:${join(directory, tarball)}`,
          three: `file:${resolve(ROOT, 'node_modules/three')}`,
        },
        devDependencies: {
          '@types/three': `link:${resolve(ROOT, 'node_modules/@types/three')}`,
          '@webgpu/types': `link:${resolve(ROOT, 'node_modules/@webgpu/types')}`,
        },
      }),
    );
    await writeFile(
      join(directory, 'pnpm-workspace.yaml'),
      `packages: []\noverrides:\n  meshoptimizer: link:${resolve(ROOT, 'node_modules/meshoptimizer')}\n`,
    );
    execFileSync('pnpm', ['install', '--offline', '--config.auto-install-peers=false'], {
      cwd: directory,
      stdio: 'pipe',
    });
    await writeFile(
      join(directory, 'node.ts'),
      "import {prepare,hierarchyUpdateBatch} from 'trillion3d'; if (!prepare || !hierarchyUpdateBatch) throw Error('node');",
    );
    await writeFile(
      join(directory, 'browser.ts'),
      "import {createWorld,hierarchyUpdateBatch} from 'trillion3d'; if (!createWorld || !hierarchyUpdateBatch) throw Error('browser');",
    );
    execFileSync(process.execPath, ['node.ts'], { cwd: directory, stdio: 'pipe' });
    execFileSync(process.execPath, ['--conditions=browser', 'browser.ts'], {
      cwd: directory,
      stdio: 'pipe',
    });
    await writeFile(
      join(directory, 'node.mts'),
      await readFile(resolve(ROOT, 'tests/fixtures/publicNode.mts')),
    );
    await writeFile(
      join(directory, 'browser.ts'),
      await readFile(resolve(ROOT, 'tests/fixtures/publicBrowser.ts')),
    );
    await writeFile(
      join(directory, 'common.ts'),
      await readFile(resolve(ROOT, 'tests/fixtures/publicCommon.ts')),
    );
    assert.deepEqual(
      diagnostics(join(directory, 'node.mts'), {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ['node'],
      }),
      [],
    );
    assert.deepEqual(
      diagnostics(join(directory, 'browser.ts'), {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        customConditions: ['browser'],
        lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
        types: ['@webgpu/types'],
      }),
      [],
    );
    assert.deepEqual(
      diagnostics(join(directory, 'common.ts'), {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2023.d.ts'],
        types: ['node'],
      }),
      [],
    );
    // Jolt's licence ships with the physics modules built from it.
    const notice = join(directory, 'node_modules/trillion3d/THIRD_PARTY_NOTICES.md');
    assert.match(await readFile(notice, 'utf8'), /joltPhysicsThreads\.wasm/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
