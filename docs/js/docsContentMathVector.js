/**
 * API reference for Vector math functions.
 */
export const VECTOR_CONTENT = {
  dotVector3: {
    title: 'dotVector3(a, b, aAt = 0, bAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature:
      'dotVector3(a: ArrayLike<number>, b: ArrayLike<number>, aAt?: number, bAt?: number): number',
    description: 'Computes scalar dot product between 3D vectors read at specified offsets.',
    replaces: 'Vector3.dot(v)',
    proof: 'Bench Vector3.dot (3.9× faster, bit-identical)',
    params: [
      { name: 'a', type: 'ArrayLike<number>', desc: 'First operand buffer.' },
      { name: 'b', type: 'ArrayLike<number>', desc: 'Second operand buffer.' },
      { name: 'aAt', type: 'number', desc: 'Offset in buffer a (default 0).' },
      { name: 'bAt', type: 'number', desc: 'Offset in buffer b (default 0).' },
    ],
    example: 'const dot = dotVector3(normals, lightDir, i * 3, 0);',
  },
  crossVector3: {
    title: 'crossVector3(out, a, b, outAt = 0, aAt = 0, bAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature:
      'crossVector3(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, outAt?: number, aAt?: number, bAt?: number): Float64Array',
    description: 'Computes 3D cross product out = a × b. out may safely alias a or b.',
    replaces: 'Vector3.crossVectors(a, b)',
    proof: 'Bench Vector3.crossVectors (5.0× faster)',
    params: [
      { name: 'out', type: 'Float64Array', desc: 'Target buffer.' },
      { name: 'a', type: 'ArrayLike<number>', desc: 'First operand.' },
      { name: 'b', type: 'ArrayLike<number>', desc: 'Second operand.' },
    ],
    example: 'crossVector3(tangent, normal, up);',
  },
  lengthSqVector3: {
    title: 'lengthSqVector3(v, at = 0)',
    type: 'Function',
    category: 'Vectors',
    signature: 'lengthSqVector3(v: ArrayLike<number>, at?: number): number',
    description: 'Returns squared Euclidean length x² + y² + z² of a 3D vector.',
    replaces: 'Vector3.lengthSq()',
    proof: 'Bench Vector3.length (1.7× faster)',
    params: [
      { name: 'v', type: 'ArrayLike<number>', desc: 'Buffer.' },
      { name: 'at', type: 'number', desc: 'Start index.' },
    ],
    example: 'const d2 = lengthSqVector3(delta);',
  },
  scaleVector3: {
    title: 'scaleVector3(out, s, outAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature: 'scaleVector3(out: Float64Array, s: number, outAt?: number): Float64Array',
    description: 'Scales three components of vector in place by scalar s.',
    replaces: 'Vector3.multiplyScalar(s)',
    proof: 'Bench Vector3.multiplyScalar (4.3× faster)',
    params: [
      { name: 'out', type: 'Float64Array', desc: 'Target modified in place.' },
      { name: 's', type: 'number', desc: 'Scale factor.' },
    ],
    example: 'scaleVector3(velocity, deltaTime);',
  },
  copyScaledVector3: {
    title: 'copyScaledVector3(out, a, s, outAt = 0, aAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature:
      'copyScaledVector3(out: Float64Array, a: ArrayLike<number>, s: number, outAt?: number, aAt?: number): Float64Array',
    description: 'Writes out = a · s without mutating source vector a.',
    replaces: 'Vector3.copy().multiplyScalar(s)',
    proof: 'Bit-identical with reference',
    params: [
      { name: 'out', type: 'Float64Array', desc: 'Destination.' },
      { name: 'a', type: 'ArrayLike<number>', desc: 'Source.' },
      { name: 's', type: 'number', desc: 'Scale.' },
    ],
    example: 'copyScaledVector3(rayStep, rayDir, stepSize);',
  },
  transformAffinePoint: {
    title: 'transformAffinePoint(out, m, x, y, z, outAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature:
      'transformAffinePoint(out: Float64Array, m: ArrayLike<number>, x: number, y: number, z: number, outAt?: number): Float64Array',
    description: 'Transforms a 3D point (x, y, z, 1) by a 4×4 affine matrix.',
    replaces: 'Vector3.applyMatrix4(m)',
    proof: 'Bench Vector3.applyMatrix4 (2.4× faster)',
    params: [
      { name: 'out', type: 'Float64Array', desc: 'Output buffer.' },
      { name: 'm', type: 'ArrayLike<number>', desc: '4×4 transform.' },
    ],
    example: 'transformAffinePoint(worldPos, worldMatrix, 10, 0, -5);',
  },
  normalizeVector3: {
    title: 'normalizeVector3(out, outAt = 0)',
    type: 'Function',
    category: 'Vectors',
    signature: 'normalizeVector3(out: Float64Array, outAt?: number): Float64Array',
    description: 'Normalizes 3D vector in place to unit length; leaves zeros unchanged.',
    replaces: 'Vector3.normalize()',
    proof: 'mathVector.test.ts',
    params: [{ name: 'out', type: 'Float64Array', desc: 'Vector to normalize.' }],
    example: 'normalizeVector3(normal);',
  },
};
