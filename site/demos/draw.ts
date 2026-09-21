/** The two pictures the demos draw: a curve over [0, 1], and vectors seen from above. */
import { formatNumber } from './kit.ts';

export function drawCurve(context, width, height, fn) {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#898781';
  context.beginPath();
  context.moveTo(0, height - 1);
  context.lineTo(width, height - 1);
  context.stroke();
  context.strokeStyle = '#3987e5';
  context.lineWidth = 2;
  context.beginPath();
  for (let pixel = 0; pixel <= width; pixel++) {
    const x = pixel / width;
    const y = height - fn(x) * (height - 6) - 3;
    if (pixel === 0) context.moveTo(pixel, y);
    else context.lineTo(pixel, y);
  }
  context.stroke();
}

/** Vectors seen from above: x to the right, z downwards, the origin at the centre. */
export function drawVectors(context, width, height, vectors) {
  const unit = Math.min(width, height) / 6;
  const cx = width / 2,
    cy = height / 2;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = 'rgba(128,128,128,0.35)';
  context.beginPath();
  context.moveTo(0, cy);
  context.lineTo(width, cy);
  context.moveTo(cx, 0);
  context.lineTo(cx, height);
  context.stroke();
  context.lineWidth = 2;
  for (const { v, colour, label } of vectors) {
    const x = cx + v[0] * unit,
      y = cy + v[2] * unit;
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(x, y);
    context.stroke();
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fill();
    context.font = '12px ui-monospace, monospace';
    context.fillText(`${label} (y ${formatNumber(v[1])})`, x + 6, y - 6);
  }
}
