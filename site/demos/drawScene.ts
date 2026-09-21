/**
 * The little world the selection demos share, seen from above: the camera at the origin
 * looking down its own −z, its field of view, and the boxes coloured by the verdict the engine
 * function returned — nothing here decides anything, it only draws what it was handed.
 */
const KEPT = '#199e70';
const STRADDLING = '#c98500';
const REJECTED = '#d95926';

/** One box of the scene, with the frustum verdict already computed by the caller. */
interface SceneBox {
  box: readonly [number, number, number, number, number, number];
  out: boolean;
  state: number;
}

interface SceneSpec {
  boxes: SceneBox[];
  turn: number;
  fov: number;
  aspect: number;
}

export function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  { boxes, turn, fov, aspect }: SceneSpec,
) {
  const unit = height / 11;
  const cx = width / 2;
  const cy = height - 12;
  context.clearRect(0, 0, width, height);
  drawGrid(context, width, height, cx, cy, unit);
  drawFrustum(context, cx, cy, turn, fov, aspect, height);
  for (const { box, out, state } of boxes) {
    const colour = out ? REJECTED : state === 2 ? KEPT : STRADDLING;
    const x0 = cx + box[0] * unit,
      x1 = cx + box[3] * unit;
    // The camera looks down −z, so a smaller z is further up the picture.
    const z0 = cy + box[2] * unit,
      z1 = cy + box[5] * unit;
    context.fillStyle = `${colour}33`;
    context.strokeStyle = colour;
    context.lineWidth = 2;
    context.beginPath();
    context.rect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    context.fill();
    context.stroke();
  }
  legend(context, width);
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number,
  unit: number,
) {
  context.strokeStyle = 'rgba(128,128,128,0.18)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = cx % unit; x < width; x += unit) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = cy; y > 0; y -= unit) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawFrustum(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  turn: number,
  fov: number,
  aspect: number,
  height: number,
) {
  // `fov` is vertical; from above, what bounds the picture is the horizontal half-angle.
  const half = Math.atan(aspect * Math.tan(((fov / 2) * Math.PI) / 180));
  const far = height;
  context.fillStyle = 'rgba(57,135,229,0.12)';
  context.strokeStyle = 'rgba(57,135,229,0.7)';
  context.lineWidth = 2;
  context.beginPath();
  // The camera looks toward (−sin θ, −cos θ): a rotation of θ about y applied to its own −z.
  context.moveTo(cx, cy);
  context.lineTo(cx - Math.sin(turn - half) * far, cy - Math.cos(turn - half) * far);
  context.lineTo(cx - Math.sin(turn + half) * far, cy - Math.cos(turn + half) * far);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = '#3987e5';
  context.beginPath();
  context.arc(cx, cy, 4, 0, Math.PI * 2);
  context.fill();
}

function legend(context: CanvasRenderingContext2D, width: number) {
  const items = [
    [KEPT, 'entirely inside'],
    [STRADDLING, 'straddling'],
    [REJECTED, 'rejected'],
  ];
  context.font = '11px ui-monospace, monospace';
  let x = 10;
  for (const [colour, label] of items) {
    context.fillStyle = colour;
    context.fillRect(x, 10, 10, 10);
    context.fillStyle = 'rgba(150,150,150,0.95)';
    context.fillText(label, x + 14, 19);
    x += 24 + context.measureText(label).width;
    if (x > width - 60) break;
  }
}
