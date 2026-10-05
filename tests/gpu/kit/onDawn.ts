// The GPU every proof runs on: Dawn in this Node process, the WebGPU implementation Chrome runs, on
// the machine's own GPU and with no browser — the bench's globals (`bench/dawn/device.ts`) and its
// page browser (`bench/dawn/dom.ts`). A proof loads its page module from the sources, as the bench
// loads the engine, then calls it: what the page answers is the proof's reading.
import { pathToFileURL } from 'node:url';
import { installDawn } from '../../../bench/dawn/device.ts';
import { takeBenchLock } from '../../../bench/dawn/lock.ts';
import { assertProofEntryPoint } from '../../../bench/dawn/proofs.ts';
import { installBrowser } from '../../../bench/dawn/dom.ts';

let installed = false;

/**
 * Dawn and the page browser on this process, once: its animation frames run sixty times a second
 * as a browser runs them (`animationFrame`). A page module is imported only after it: its
 * constants read the WebGPU globals. The GPU is opened under the machine's bench lock — shared
 * with `pnpm run test:gpu` that started the proof, taken by a proof run on its own.
 */
export function installProofGpu() {
  if (installed) return;
  assertProofEntryPoint();
  takeBenchLock(`GPU proof ${process.argv[1] ?? ''}`);
  installed = true;
  installDawn();
  const browser = installBrowser(
    { width: 800, height: 600, ratio: 1 },
    pathToFileURL(`${process.cwd()}/`).href,
    [],
    [],
  );
  // Never what keeps the process alive: a proof's own work does (`runOnDawn`).
  setInterval(() => browser.frame(performance.now()), 1000 / 60).unref();
}

/** The page's next animation frame, written once for both the proofs' GPUs (`frame.ts`). */
export { animationFrame } from './frame.ts';

/**
 * Loads the page module `input` on Dawn from its sources and installs it as `globalThis[name]`,
 * the name the proof's callback reads it by. Returns the module.
 */
export async function loadPage(input: string, name: string): Promise<Record<string, unknown>> {
  installProofGpu();
  const page = (await import(pathToFileURL(input).href)) as Record<string, unknown>;
  (globalThis as Record<string, unknown>)[name] = page;
  return page;
}

/**
 * Runs `callback(argument)` on Dawn and resolves to what it answers, the process held alive while
 * it runs — its frames may be all that is left to wait for. With `pageErrors`, an error nothing
 * catches while it runs — a frame callback's, a rejected promise — fills it instead of ending the
 * proof.
 */
export async function runOnDawn<A, R>(
  callback: (argument: A) => R | Promise<R>,
  argument: A,
  pageErrors?: string[],
): Promise<R> {
  installProofGpu();
  const caught = (error: unknown) =>
    void pageErrors?.push(error instanceof Error ? error.message : String(error));
  if (pageErrors) {
    process.on('uncaughtException', caught);
    process.on('unhandledRejection', caught);
  }
  const held = setInterval(() => {}, 60_000);
  try {
    return await callback(argument);
  } finally {
    clearInterval(held);
    process.off('uncaughtException', caught);
    process.off('unhandledRejection', caught);
  }
}
