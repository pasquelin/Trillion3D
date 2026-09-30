import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCacheIdentity } from './cache.ts';
import { dagWarningsDiagnostic } from './dagWarnings.ts';

const root = () => ({
  schema: 9,
  formatVersion: 9,
  errorModel: 'dag-group-qem-v3',
  primitives: [],
});
const refuse = (value: unknown, code: string, message: string, details?: unknown) => {
  assert.throws(
    () => assertCacheIdentity(value as any),
    (error: any) => {
      assert.equal(error.code, code);
      assert.ok(error.message.includes(message));
      if (details) assert.deepEqual(error.details, details);
      return true;
    },
  );
};

test('identity refuses undecoded sidecars, incompatible formats and stale texture layouts', () => {
  assert.doesNotThrow(() => assertCacheIdentity(root() as any));
  assert.doesNotThrow(() => assertCacheIdentity({ ...root(), formatVersion: undefined } as any));
  refuse({ ...root(), binary: { url: 'columns.bin' } }, 'INVALID_CACHE', 'decoded');
  refuse({ ...root(), schema: 10 }, 'UNSUPPORTED_FORMAT', 'differ', {
    schema: 10,
    formatVersion: 9,
  });
  refuse({ ...root(), formatVersion: 1, schema: 1 }, 'UNSUPPORTED_FORMAT', 'received 1');
  for (const errorModel of [undefined, 'dag-group-qem-v1'])
    refuse(
      { ...root(), errorModel },
      'STALE_CACHE',
      `Cache error model ${errorModel ?? 'absent'}`,
      { errorModel: errorModel ?? null, expected: 'dag-group-qem-v3' },
    );
  for (const version of [undefined, 5])
    refuse({ ...root(), textures: { version } }, 'STALE_CACHE', `version ${version ?? 'absent'}`, {
      textureVersion: version ?? null,
      expected: 6,
    });
  assert.doesNotThrow(() => assertCacheIdentity({ ...root(), textures: { version: 6 } } as any));
});

test('identity accepts whole meshes and refuses stale primitives with actionable identity', () => {
  assert.doesNotThrow(() =>
    assertCacheIdentity({
      ...root(),
      schema: 10,
      formatVersion: 10,
      primitives: [
        {
          mesh: 3,
          primitive: 7,
          pass: 'clustered-blend',
          pages: [{ lodError: 0, sphere: [0, 0, 0, 1] }],
        },
      ],
    } as any),
  );
  const whole = { mesh: 3, primitive: 7, pass: 'shared-blend', pages: [] };
  assert.doesNotThrow(() => assertCacheIdentity({ ...root(), primitives: [whole] } as any));
  refuse(
    { ...root(), primitives: [{ ...whole, pages: [1] }] },
    'STALE_CACHE',
    'carries 1 cluster pages',
    {
      mesh: 3,
      primitive: 7,
      pass: 'shared-blend',
      errorModel: 'dag-group-qem-v3',
      expected: 'dag-group-qem-v3',
    },
  );
  refuse(
    { ...root(), primitives: [{ mesh: 11, primitive: 13, pages: [1] }] },
    'STALE_CACHE',
    '11/13 has no per-cluster error band',
    {
      mesh: 11,
      primitive: 13,
      pass: undefined,
      errorModel: 'dag-group-qem-v3',
      expected: 'dag-group-qem-v3',
    },
  );
  refuse(
    { ...root(), primitives: [{ ...whole, pass: 'clustered-blend' }] },
    'UNSUPPORTED_FORMAT',
    'clustered-blend',
    { formatVersion: 9 },
  );
});

test('DAG diagnostics include warnings and stalls independently without mutating the manifest', () => {
  assert.equal(dagWarningsDiagnostic({ primitives: [] }), null);
  const warning = { code: 'MULTIPLE_ROOTS', index: 99, mesh: 99, primitive: 99 };
  const stalled = [{ mesh: 4, primitive: 2 }];
  const value = {
    primitives: [
      { mesh: 3, primitive: 7, dag: { warnings: [warning] } },
      { mesh: 5, primitive: 8 },
      { mesh: 9, primitive: 11, dag: { warnings: [] } },
    ],
    worstStalls: stalled,
  };
  const result = dagWarningsDiagnostic(value as any)!;
  assert.equal(result.phase, 'dag-warnings');
  assert.ok(
    result.message.includes('1 primitive(s)') && result.message.includes('1 in the compiler'),
  );
  assert.deepEqual(result.context, {
    count: 1,
    primitives: [{ code: 'MULTIPLE_ROOTS', index: 0, mesh: 3, primitive: 7 }],
    stalled,
  });
  assert.equal(warning.index, 99);
  assert.ok(dagWarningsDiagnostic({ primitives: [], worstStalls: stalled } as any));
  assert.ok(dagWarningsDiagnostic({ primitives: value.primitives } as any));
});
