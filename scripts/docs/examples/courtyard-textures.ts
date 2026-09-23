import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomStream, type RandomStream } from './random.ts';
import {
  blur,
  fillPolygon,
  fillRect,
  normalMap,
  png,
  raster,
  shrink,
  valueNoise,
  type Raster,
} from './raster.ts';

/**
 * The five images of the courtyard, drawn in code at 1024 texels a side: glazed tiles and brick
 * with their relief maps, and veined marble. Shapes are drawn at twice the size, brought down,
 * then softened, so their edges are smooth.
 */
const SIZE = 1024,
  DRAWN = SIZE * 2,
  // Relief strength of the normal maps: grooves a low sun rakes, soft enough that the
  // two-channel block compression stays within three levels of its lossless levels.
  RELIEF = 2;

/** Brings a drawing at twice the size down, then blurs it by `sigma` final texels. */
const soft = (image: Raster, sigma: number) => blur(shrink(image, 2), sigma);

/** A relief map from a height drawing of 0 (groove) and up to 255 (face). */
const relief = (height: Raster) => {
  const field = soft(height, 8);
  field.data.forEach((value, index) => (field.data[index] = value / 255));
  return normalMap(field, RELIEF);
};

/** Eight by eight glazed tiles, every other one inlaid with an eight-point star. */
function tiles(random: RandomStream) {
  const glazes = [
      [40, 84, 160],
      [52, 148, 162],
      [232, 228, 216],
      [46, 128, 92],
      [204, 152, 70],
    ],
    colour = raster(DRAWN, [206, 198, 180]),
    height = raster(DRAWN, [0]),
    [cell, grout] = [DRAWN / 8, 16];
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const [x0, y0, x1, y1] = [
          i * cell + grout,
          j * cell + grout,
          (i + 1) * cell - grout,
          (j + 1) * cell - grout,
        ],
        shade = random.uniform(0.92, 1.04),
        base = glazes[(i * 3 + j * 5 + ((i * j) % 3)) % 5].map((value) =>
          Math.floor(value * shade),
        );
      fillRect(colour, [x0, y0, x1, y1], base);
      fillRect(height, [x0, y0, x1, y1], [160]);
      if ((i + j) % 2) continue;
      const [cx, cy, outer, inner] = [
          (x0 + x1) / 2,
          (y0 + y1) / 2,
          (x1 - x0) * 0.4,
          (x1 - x0) * 0.2,
        ],
        star = Array.from({ length: 16 }, (_, k): [number, number] => {
          const [r, angle] = [k % 2 ? inner : outer, (k * Math.PI) / 8 + Math.PI / 8];
          return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
        }),
        brightness = base.reduce((sum, value) => sum + value, 0) / 3;
      fillPolygon(colour, star, glazes[brightness < 150 ? 2 : 0]);
    }
  return { map: soft(colour, 2), relief: relief(height) };
}

/** Running bond: eight courses of four bricks, each fired a little differently. */
function bricks(random: RandomStream) {
  const colour = raster(DRAWN, [196, 184, 164]),
    height = raster(DRAWN, [0]),
    [course, width, mortar] = [DRAWN / 8, DRAWN / 4, 24];
  for (let row = 0; row < 8; row++) {
    const offset = ((row % 2) * width) / 2;
    for (let k = -1; k < 5; k++) {
      const [x0, y0] = [k * width + offset + mortar / 2, row * course + mortar / 2],
        rect = [x0, y0, x0 + width - mortar, y0 + course - mortar],
        [hue, fired] = [random.uniform(-1, 1), random.uniform(0.82, 1.08)];
      fillRect(
        colour,
        rect,
        [164 + 22 * hue, 84 + 12 * hue, 60 + 6 * hue].map((value) => Math.floor(value * fired)),
      );
      fillRect(height, rect, [150]);
    }
  }
  return { map: soft(colour, 2), relief: relief(height) };
}

/** White marble with soft grey veins: turbulence bent through a sine. */
function marble(random: RandomStream) {
  const turbulence = valueNoise(SIZE, 4, 4, random),
    image = raster(SIZE, [0, 0, 0]),
    [white, grey] = [
      [236, 232, 224],
      [150, 146, 142],
    ];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const vein = Math.abs(
          Math.sin(((x + y) / SIZE) * 2 * Math.PI * 2 + turbulence[y * SIZE + x] * 7),
        ),
        weight = Math.exp(-vein * 5);
      for (let k = 0; k < 3; k++)
        image.data[(y * SIZE + x) * 3 + k] = white[k] * (1 - weight) + grey[k] * weight;
    }
  return image;
}

/** Writes the five images under `directory/textures/`; returns their paths from `directory`. */
export async function writeCourtyardTextures(directory: string) {
  await mkdir(resolve(directory, 'textures'), { recursive: true });
  const random = randomStream(5),
    { map: tileMap, relief: tileRelief } = tiles(random),
    { map: brickMap, relief: brickRelief } = bricks(random),
    images = {
      tiles: tileMap,
      'tiles-normal': tileRelief,
      bricks: brickMap,
      'bricks-normal': brickRelief,
      marble: marble(random),
    };
  for (const [name, image] of Object.entries(images))
    await writeFile(resolve(directory, `textures/${name}.png`), png(image));
  return Object.fromEntries(
    Object.keys(images).map((name) => [name, `textures/${name}.png`]),
  ) as Record<keyof typeof images, string>;
}
