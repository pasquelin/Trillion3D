const gaussian = (x, z, cx, cz, sx, sz, height) =>
  height * Math.exp(-((x - cx) ** 2) / sx - (z - cz) ** 2 / sz);

const valleyCenter = (z) => 0.35 + 0.48 * Math.sin(z * 0.48) - 0.08 * z;

export function terrainHeight(x, z) {
  const west = gaussian(x, z, -2.5, 0.3, 1.9, 11, 4.4),
    north = gaussian(x, z, 0.1, -2.5, 1.05, 2.2, 4.8),
    east = gaussian(x, z, 2.55, 0.1, 1.1, 13, 4.1),
    shoulder = gaussian(x, z, -0.4, 2.9, 3.2, 1.25, 2.7),
    massif = west + north + east + shoulder,
    channel = Math.exp(-((x - valleyCenter(z)) ** 2) / 0.5),
    ravines =
      0.5 * Math.exp(-((x + 2.4 + 0.35 * z) ** 2) / 0.11) +
      0.42 * Math.exp(-((x - 2.65 + 0.22 * z) ** 2) / 0.1),
    erosion =
      (0.13 * Math.sin(x * 2.8 + z * 0.7) + 0.1 * Math.sin(z * 3.4 - x)) *
      Math.min(1, massif / 1.5),
    plateau = gaussian(x, z, 3.15, -3.05, 0.7, 0.65, 1.25);
  return massif - channel * (1.15 + massif * 0.28) - ravines * massif + erosion + plateau;
}

const bandFor = (height) => (height < 0.45 ? 0 : height < 1.45 ? 1 : height < 2.7 ? 2 : 3);

export function mountainTerrain(detail = 96) {
  const positions = [],
    bands = [[], [], [], []];
  for (let u = 0; u <= detail; u++)
    for (let v = 0; v <= detail; v++) {
      const x = (u / detail - 0.5) * 12,
        z = (v / detail - 0.5) * 12;
      positions.push(x, terrainHeight(x, z), z);
    }
  const vertex = (u, v) => u * (detail + 1) + v;
  for (let u = 0; u < detail; u++)
    for (let v = 0; v < detail; v++) {
      const a = vertex(u, v),
        b = vertex(u + 1, v),
        c = vertex(u + 1, v + 1),
        d = vertex(u, v + 1);
      for (const triangle of [
        [a, b, c],
        [a, c, d],
      ]) {
        const height = triangle.reduce((sum, index) => sum + positions[index * 3 + 1], 0) / 3;
        bands[bandFor(height)].push(...triangle);
      }
    }
  const river = [],
    riverMargin = Math.max(1, Math.round(detail / 12));
  for (let step = riverMargin; step <= detail - riverMargin; step++) {
    const z = (step / detail - 0.5) * 12,
      x = valleyCenter(z),
      width = 0.2 + 0.03 * Math.cos(z * 0.7),
      left = x - width,
      right = x + width;
    positions.push(
      left,
      terrainHeight(left, z) + 0.08,
      z,
      right,
      terrainHeight(right, z) + 0.08,
      z,
    );
  }
  const riverSegments = detail - riverMargin * 2,
    start = positions.length / 3 - (riverSegments + 1) * 2;
  for (let step = 0; step < riverSegments; step++) {
    const a = start + step * 2,
      b = a + 2;
    river.push(a, b, b + 1, a, b + 1, a + 1);
  }
  return { positions, bands, river, indices: [...bands.flat(), ...river] };
}
