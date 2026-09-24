import type { Road } from './types.ts';

/**
 * A round map in the corner: the road network around the player, north up, the player an arrow
 * at the centre. The whole network is drawn once into a large canvas; each refresh copies the
 * window around the player out of it.
 */
export type Minimap = {
  element: HTMLCanvasElement;
  draw(x: number, z: number, heading: number): void;
};

const WIDTHS: Partial<Record<Road['class'], number>> = {
  highway: 3,
  secondary: 2,
  pass: 2,
  runway: 4,
};
const COLOURS: Partial<Record<Road['class'], string>> = {
  highway: '#f5c451',
  secondary: '#e8e2d0',
  pass: '#e8e2d0',
  runway: '#9aa3ad',
  taxiway: '#6d7580',
  dirt: '#a3865c',
};

/** The map's pixel for world (x, z), on a sheet of `pixels` for a world of `size` metres. */
const toSheet = (x: number, z: number, size: number, pixels: number): [number, number] => [
  ((x + size / 2) / size) * pixels,
  ((z + size / 2) / size) * pixels,
];

export function minimap(roads: readonly Road[], size: number, span = 4000, pixels = 176): Minimap {
  const sheet = document.createElement('canvas');
  // Resolution of the sheet: the window of `span` metres fills the map at a pixel per pixel.
  sheet.width = sheet.height = Math.min(4096, Math.ceil((size / span) * pixels));
  const ink = sheet.getContext('2d')!;
  ink.fillStyle = '#1d2b24';
  ink.fillRect(0, 0, sheet.width, sheet.height);
  ink.lineCap = ink.lineJoin = 'round';
  for (const road of roads) {
    ink.strokeStyle = COLOURS[road.class] ?? '#c9c3b3';
    ink.lineWidth = WIDTHS[road.class] ?? 1;
    ink.beginPath();
    road.points.forEach(([x, , z], i) => {
      const [u, v] = toSheet(x, z, size, sheet.width);
      if (i) ink.lineTo(u, v);
      else ink.moveTo(u, v);
    });
    ink.stroke();
  }
  const element = document.createElement('canvas');
  element.width = element.height = pixels;
  element.className = 'rounded-full shadow-xl';
  const view = element.getContext('2d')!;
  return {
    element,
    draw(x, z, heading) {
      const [u, v] = toSheet(x, z, size, sheet.width);
      const window = (span / size) * sheet.width;
      view.clearRect(0, 0, pixels, pixels);
      view.save();
      view.beginPath();
      view.arc(pixels / 2, pixels / 2, pixels / 2, 0, 2 * Math.PI);
      view.clip();
      view.fillStyle = '#1d2b24';
      view.fillRect(0, 0, pixels, pixels);
      view.drawImage(sheet, u - window / 2, v - window / 2, window, window, 0, 0, pixels, pixels);
      // The player's arrow, turned to the heading (0 facing north, counter-clockwise positive).
      view.translate(pixels / 2, pixels / 2);
      view.rotate(-heading);
      view.fillStyle = '#ff5a36';
      view.beginPath();
      view.moveTo(0, -9);
      view.lineTo(6, 7);
      view.lineTo(0, 3);
      view.lineTo(-6, 7);
      view.closePath();
      view.fill();
      view.restore();
    },
  };
}
