/**
 * The live viewport: one mesh, drawn from matrices the engine's own kernels compute
 * (`engine.js`, bundled from the packages). Reversed depth and infinite far plane come
 * from the engine's own constants, so this page cannot show a convention the engine abandoned.
 *
 * The device, the pipeline and the buffers are built on the first visit and reused: a visitor
 * who walks the sidebar does not pay a pipeline compilation per page.
 */
import {
  composeMatrix4,
  multiplyMatrix4,
  perspectiveProjection,
  DEPTH_CLEAR,
  DEPTH_COMPARE_OR_EQUAL,
} from './engine.js';
import { buildCubeGeometry, WGSL_SHADER } from './demoGeometry.js';
import { createGpuResources } from './demoPipeline.js';

let animationId = null;
let gpu = null;
/** Which visit owns the loop and the device: a second visit invalidates the first. */
let visit = 0;
let rotX = 0.5,
  rotY = 0.7;
let dragging = false,
  lastX = 0,
  lastY = 0;

/** Per-frame operands, allocated once: the demo claims no allocation, and keeps its word. */
const modelM = new Float64Array(16);
const projM = new Float64Array(16);
const mvpM = new Float64Array(16);
const uniforms = new Float32Array(20);
/** The shader reads slot 16 as a `u32`: writing a float there would send its bit pattern. */
const uniformWords = new Uint32Array(uniforms.buffer);
const position = new Float64Array([0, 0, -4.2]);
const rotation = new Float64Array(4);
const scale = new Float64Array([0.8, 0.8, 0.8]);

export function stopWebGpuDemo() {
  visit++;
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

export async function initWebGpuDemo(canvas, statsEl, options) {
  stopWebGpuDemo();
  const mine = visit;
  setupPointer(canvas);
  if (!navigator.gpu) {
    statsEl.textContent = 'WebGPU is unavailable in this browser: nothing is drawn.';
    return;
  }
  if (!gpu) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      statsEl.textContent = 'No WebGPU adapter answered: nothing is drawn.';
      return;
    }
    const device = await adapter.requestDevice();
    if (mine !== visit) return device.destroy(); // a later visit already owns the demo
    gpu = createGpuResources(device, {
      shader: WGSL_SHADER,
      geometry: buildCubeGeometry(),
      format: navigator.gpu.getPreferredCanvasFormat(),
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    });
  }
  if (mine !== visit) return;
  const context = canvas.getContext('webgpu');
  context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' });
  loop(canvas, context, statsEl, options, mine);
}

function loop(canvas, context, statsEl, options, mine) {
  let windowStart = performance.now(),
    frames = 0;

  function frame(now) {
    if (mine !== visit) return; // a later visit owns the loop now
    if (!canvas.isConnected) return stopWebGpuDemo(); // the visitor left the demo page
    resize(canvas);
    if (!dragging) rotY += 0.008;
    writeMatrices(canvas, options.fov());
    uniforms.set(mvpM);
    uniformWords[16] = options.mode() === 'normals' ? 1 : 0;
    gpu.draw(context, canvas, uniforms, DEPTH_CLEAR);
    frames++;
    if (now - windowStart >= 500) {
      report(statsEl, frames, now - windowStart);
      frames = 0;
      windowStart = now;
    }
    animationId = requestAnimationFrame(frame);
  }
  animationId = requestAnimationFrame(frame);
}

/** Model, projection and their product, from the engine kernels, into the three owned buffers. */
function writeMatrices(canvas, fovDegrees) {
  const halfX = rotX * 0.5,
    halfY = rotY * 0.5;
  const sx = Math.sin(halfX),
    cx = Math.cos(halfX),
    sy = Math.sin(halfY),
    cy = Math.cos(halfY);
  rotation[0] = sx * cy;
  rotation[1] = cx * sy;
  rotation[2] = -sx * sy;
  rotation[3] = cx * cy;
  composeMatrix4(modelM, position, rotation, scale);
  perspectiveProjection(projM, fovDegrees, canvas.width / Math.max(1, canvas.height), 0.1, 1);
  multiplyMatrix4(mvpM, projM, modelM);
}

/**
 * Frames per second, and nothing else about time: three kernel calls fall below the page
 * clock's resolution, and a figure that swings with its tick is not a measurement.
 * `pnpm run perf:core` is where these kernels are timed against the host library.
 */
function report(statsEl, frames, spanMs) {
  const fps = Math.round((frames * 1000) / spanMs);
  statsEl.textContent = `${fps} FPS · 3 engine kernel calls per frame · reversed Z, depth cleared to ${DEPTH_CLEAR}`;
}

function resize(canvas) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function setupPointer(canvas) {
  canvas.onpointerdown = (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const release = (event) => {
    dragging = false;
    // Only the capture we took is released: a pointer pressed outside the canvas never had one.
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.onpointerup = release;
  canvas.onpointercancel = release;
  canvas.onpointermove = (event) => {
    if (!dragging) return;
    rotY += (event.clientX - lastX) * 0.01;
    rotX += (event.clientY - lastY) * 0.01;
    lastX = event.clientX;
    lastY = event.clientY;
  };
}
