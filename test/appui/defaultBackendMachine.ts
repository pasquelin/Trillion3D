// The machine a default-backend proof opens: a browser context that either offers WebGPU or does
// not, with the SDK loaded from `dist/`. One place, because "a machine without WebGPU" must mean
// the same thing in every proof that claims it — the capability is removed where the engine reads
// it, `navigator.gpu`, and nothing else about the context changes.
import type { Browser, Page } from 'playwright';
import type { Server } from 'node:http';
import { serverPort } from '../../scripts/mesure/serveur.ts';
import type { runDefaultBackendCase } from './defaultBackendCase.ts';

declare global {
  var sdk: typeof import('../../packages/sdk-browser/measurement.ts');
  var proof: { images: Record<string, number[]> } | undefined;
}

export type CaseResult = Awaited<ReturnType<typeof runDefaultBackendCase>>;

/** The `backend-choice` diagnostic of a case, the engine's own account of what it picked. */
export const chosenBackend = (result: CaseResult) =>
  result.diagnostics.find((event) => event.phase === 'backend-choice')?.context ?? null;

/** Name a capture and a result column carry for the machine they were read on. */
export const machineLabel = (webgpu: boolean) => (webgpu ? 'webgpu' : 'webgl2-only');

export async function openMachine(input: {
  browser: Browser;
  server: Server;
  /** False removes `navigator.gpu`, so no adapter and no device can be obtained. */
  webgpu: boolean;
  /** Page errors are collected here; a proof asserts the list is empty. */
  errors: string[];
}) {
  const context = await input.browser.newContext({
    viewport: { width: 640, height: 480 },
    deviceScaleFactor: 1,
  });
  if (!input.webgpu)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    });
  const page: Page = await context.newPage();
  page.on('pageerror', (error) => input.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${serverPort(input.server)}`);
  await page.evaluate(async (url) => {
    window.sdk = await import(url);
  }, '/sdk/sdk-browser/measurement.js');
  return { context, page };
}
