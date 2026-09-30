import test from 'node:test';
import assert from 'node:assert/strict';
import { stripShaderComments } from './build-bundle.ts';

test("a shader's comment lines leave the bundle, every line and all its code in place", () => {
  const source = [
    'const a=`fn f()->f32{',
    ' // the shader compiler never reads this',
    ' return 1.0;',
    '  // kept: ${x} is code',
    '// kept: it ends at the backtick`;const b=`',
    '// @license kept',
    '`;',
    '//# sourceMappingURL=a.js.map',
    '',
  ].join('\n');
  const stripped = stripShaderComments(source).split('\n');
  assert.equal(stripped.length, source.split('\n').length);
  assert.equal(stripped[1], '');
  assert.deepEqual(
    stripped.filter((_, i) => i !== 1),
    source.split('\n').filter((_, i) => i !== 1),
  );
});
