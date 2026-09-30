import test from 'node:test';
import assert from 'node:assert/strict';
import { stripShaderComments } from './build-bundle.ts';

test("a shader's comment lines leave the bundle, every line and all its code in place", () => {
  const source = [
    'const a=`fn f()->f32{',
    ' // the shader compiler never reads this',
    ' return 1.0;',
    '/* a block\n // kept: it closes the block */',
    '  // kept: ${x} is code',
    ' // kept: \\n may be a line break',
    '// kept: it ends at the backtick`;const b=`',
    '// @license kept',
    '`;',
    '//# sourceMappingURL=a.js.map',
    '',
  ].join('\n');
  assert.equal(
    stripShaderComments(source),
    source.replace(' // the shader compiler never reads this', ''),
  );
});
