// Streaming-queue oracle of batch M1 "math foundation": `orderPendingUrls` from before the
// attachment, copied as-is from `develop` at commit d016f88 (`streamingPriority.ts:46-129`),
// with the product in a loop from zero and the view centre written inline.
import { clusterErrorPixels, maxStretch } from '../../../sdk-core/index.ts';
import { referenceComposeView, referenceProject } from './socle-math.mjs';

const centre = new Float64Array(4),
  bounds = new Float64Array(4);
function boundsSphere(record, out) {
  out[0] = (record.min[0] + record.max[0]) / 2;
  out[1] = (record.min[1] + record.max[1]) / 2;
  out[2] = (record.min[2] + record.max[2]) / 2;
  out[3] = Math.hypot(record.max[0] - out[0], record.max[1] - out[1], record.max[2] - out[2]);
  return out;
}

/** Error and distance of each record, as the queue compared them. */
function referencePriorities(records, camera, pixelScale) {
  const focal = Math.max(pixelScale[0], pixelScale[1]),
    near = camera.near;
  const views = new Map(),
    sortie = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.array) {
      sortie.push(NaN, NaN, NaN);
      continue;
    }
    let frame = views.get(record.matrix);
    if (!frame) {
      const view = new Float64Array(16);
      referenceComposeView(view, camera.matrixWorldInverse.elements, record.matrix.elements);
      frame = { view, stretch: maxStretch(view) };
      views.set(record.matrix, frame);
    }
    const sphere = record.parentSphere ?? record.sphere;
    const error = record.parentError ?? record.lodError;
    let pixels, distance;
    if (sphere && sphere.length === 4) {
      referenceProject(frame.view, sphere, centre);
      pixels =
        error == null
          ? Infinity
          : clusterErrorPixels(
              error,
              frame.stretch,
              centre[0],
              centre[1],
              centre[2],
              centre[3],
              focal,
              near,
            );
      distance = Math.hypot(centre[0], centre[1], centre[2]);
    } else {
      referenceProject(frame.view, boundsSphere(record, bounds), centre);
      distance = Math.hypot(centre[0], centre[1], centre[2]);
      pixels = (centre[3] * frame.stretch * focal) / Math.max(distance, near);
    }
    sortie.push(frame.stretch, pixels, distance);
  }
  return Float64Array.from(sortie);
}

/** The rendered order: decreasing error, then increasing distance, the worst cluster per bundle. */
export function referenceOrder(records, camera, pixelScale) {
  const valeurs = referencePriorities(records, camera, pixelScale),
    slots = new Map();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.array) continue;
    const key = record.streamUrl ?? record.url,
      pixels = valeurs[index * 3 + 1],
      distance = valeurs[index * 3 + 2];
    const held = slots.get(key);
    if (!held) {
      slots.set(key, { url: key, error: pixels, distance });
      continue;
    }
    if (pixels > held.error || (pixels === held.error && distance < held.distance)) {
      held.error = pixels;
      held.distance = distance;
    }
  }
  return [...slots.values()]
    .sort((a, b) => b.error - a.error || a.distance - b.distance)
    .map((slot) => slot.url);
}
