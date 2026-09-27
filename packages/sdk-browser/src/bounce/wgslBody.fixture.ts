import assert from 'node:assert/strict';

/** A WGSL function of `shader`, from `fn name(` to the first line that closes it. */
export const functionText = (shader: string, name: string) => {
  const start = shader.indexOf(`fn ${name}(`);
  assert.ok(start >= 0, `${name} is declared`);
  return shader.slice(start, shader.indexOf('\n}', start));
};
