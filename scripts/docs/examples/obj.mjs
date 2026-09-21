import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

/** Copies an OBJ with its vertices scaled then moved: `v` lines change, nothing else does. */
export async function placeObj(input, output, { scale = 1, offset = [0, 0, 0] } = {}) {
  const text = await readFile(input, 'utf8');
  const placed = text.replaceAll(/^v (\S+) (\S+) (\S+)/gm, (_, x, y, z) =>
    ['v', ...[x, y, z].map((value, axis) => Number(value) * scale + offset[axis])].join(' '),
  );
  await writeFile(output, placed);
}

/** Writes axis-aligned boxes, `[center, size, material]` each, as one OBJ with its material
 * library beside it: `materials` maps a name to `[r, g, b]`. */
export async function writeBoxesObj(file, boxes, materials) {
  const lines = [`mtllib ${basename(file, '.obj')}.mtl`],
    normals = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  for (const normal of normals) lines.push(`vn ${normal.join(' ')}`);
  let vertex = 1;
  for (const [center, size, material] of boxes) {
    lines.push(`usemtl ${material}`);
    normals.forEach(([nx, ny, nz], face) => {
      const axis = Math.floor(face / 2),
        across = (axis + 1) % 3,
        up = (axis + 2) % 3,
        sign = axis === 0 ? nx : axis === 1 ? ny : nz;
      for (const [u, v] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const point = [...center];
        point[axis] += (sign * size[axis]) / 2;
        point[across] += (sign * u * size[across]) / 2;
        point[up] += (v * size[up]) / 2;
        lines.push(`v ${point.map((value) => value.toFixed(4)).join(' ')}`);
      }
      const n = face + 1;
      lines.push(
        `f ${vertex}//${n} ${vertex + 1}//${n} ${vertex + 2}//${n}`,
        `f ${vertex}//${n} ${vertex + 2}//${n} ${vertex + 3}//${n}`,
      );
      vertex += 4;
    });
  }
  await writeFile(file, lines.join('\n') + '\n');
  await writeFile(
    file.replace(/\.obj$/, '.mtl'),
    Object.entries(materials)
      .map(([name, [r, g, b]]) => `newmtl ${name}\nKd ${r} ${g} ${b}\nKs 0 0 0\n`)
      .join('\n'),
  );
}
