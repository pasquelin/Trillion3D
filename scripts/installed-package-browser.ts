import type { Browser } from 'playwright';
import { launchChrome } from '../bench/runner/chrome.ts';
import { evaluateInstalledPage } from './installed-package-browser-page.ts';
import {
  installedBrowserResult,
  type InstalledBrowserProof,
} from './installed-package-browser-result.ts';
import {
  evidenceRequests,
  installedServer,
  type RequestRecord,
} from './installed-package-server.ts';
import { runInstalledWorkers } from './installed-package-workers.ts';

export async function runInstalledBrowser({
  root,
  html,
  moduleName,
  decodeWorkerPath,
  integrationWorkerPath,
  commonWorkerPath,
  allowNodeModules = false,
  manifestUrl,
  replayUrl,
}: {
  root: string;
  html: string;
  moduleName: string | null;
  decodeWorkerPath: string;
  integrationWorkerPath: string;
  commonWorkerPath: string;
  allowNodeModules?: boolean;
  manifestUrl: string;
  replayUrl: string;
}): Promise<InstalledBrowserProof> {
  const requests: RequestRecord[] = [];
  const server = installedServer(root, html, requests, allowNodeModules);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('browser proof server unavailable');
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    browser = await launchChrome({ headless: true });
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(evaluateInstalledPage, {
      moduleName,
      manifestUrl,
      replayUrl: `http://localhost:${address.port}${replayUrl}`,
      commonWorkerPath,
    });
    const { geometryUrl } = result;
    const workers = await page.evaluate(runInstalledWorkers, {
      pageUrl: geometryUrl,
      decodeWorkerUrl: `http://127.0.0.1:${address.port}${decodeWorkerPath}`,
      integrationWorkerUrl: `http://127.0.0.1:${address.port}${integrationWorkerPath}`,
    });
    return installedBrowserResult({
      result,
      workers,
      requests,
      evidence: evidenceRequests(requests),
      allowNodeModules,
      browserVersion: browser.version(),
      errors,
    });
  } catch (error) {
    const evidence = JSON.stringify(evidenceRequests(requests));
    throw new Error(`${String(error)}; requests=${evidence}; errors=${JSON.stringify(errors)}`, {
      cause: error,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
