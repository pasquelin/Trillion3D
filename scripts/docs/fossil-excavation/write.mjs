import { mkdir, rm, writeFile } from 'node:fs/promises';

const materials = {
  bone: [0.82, 0.72, 0.51],
  shadow: [0.12, 0.09, 0.07],
  sandstone: [0.56, 0.34, 0.16],
  ochre: [0.72, 0.43, 0.18],
  markerRed: [0.72, 0.08, 0.05],
  markerBlue: [0.04, 0.24, 0.62],
  paper: [0.92, 0.9, 0.76],
  metal: [0.16, 0.18, 0.2],
};

export async function writeFossilExcavation(directory, groups) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const obj = ['# Original Web Geometry fossil excavation', 'mtllib excavation.mtl'],
    mtl = [];
  let offset = 0;
  for (const [name, geometry] of Object.entries(groups)) {
    obj.push(`o ${name}`, `usemtl ${name}`);
    for (const point of geometry.vertices) obj.push(`v ${point.join(' ')}`);
    for (const indices of geometry.faces)
      obj.push(`f ${indices.map((index) => index + offset).join(' ')}`);
    offset += geometry.vertices.length;
    const [r, g, b] = materials[name];
    mtl.push(
      `newmtl ${name}`,
      `Kd ${r} ${g} ${b}`,
      `Ka ${r * 0.08} ${g * 0.08} ${b * 0.08}`,
      'Ks 0.08 0.08 0.08',
      `Ns ${name === 'bone' ? 52 : 10}`,
      'illum 2',
      '',
    );
  }
  await writeFile(`${directory}/excavation.obj`, `${obj.join('\n')}\n`);
  await writeFile(`${directory}/excavation.mtl`, `${mtl.join('\n')}\n`);
}
