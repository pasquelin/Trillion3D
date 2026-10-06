import type { Browser } from 'playwright';
import { launchChrome } from '../../bench/runner/harness/chrome.ts';
import { evaluateInstalledPage } from './browser-page.ts';
import { installedBrowserResult, type InstalledBrowserProof } from './browser-result.ts';
import { evidenceRequests, installedServer, type RequestRecord } from './server.ts';
import { installedWorkerRequests, runInstalledWorkers } from './workers.ts';
import { listen } from '../static-server.ts';

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
  /** The page, or what writes it for the port the fixture server listens on. */
  html: string | ((port: number) => string);
  moduleName: string | null;
  decodeWorkerPath: string;
  integrationWorkerPath: string;
  commonWorkerPath: string;
  allowNodeModules?: boolean;
  manifestUrl: string;
  replayUrl: string;
}): Promise<InstalledBrowserProof> {
  const requests: RequestRecord[] = [];
  let port = 0;
  const server = installedServer(
    root,
    () => (typeof html === 'string' ? html : html(port)),
    requests,
    allowNodeModules,
  );
  port = await listen(server);
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    browser = await launchChrome({ headless: true });
    const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(evaluateInstalledPage, {
      moduleName,
      manifestUrl,
      replayUrl: `http://localhost:${port}${replayUrl}`,
      commonWorkerPath,
    });
    const { geometryUrl } = result;
    const workers = await page.evaluate(runInstalledWorkers, {
      pageUrl: geometryUrl,
      decodeWorkerUrl: `http://127.0.0.1:${port}${decodeWorkerPath}`,
      integrationWorkerUrl: `http://127.0.0.1:${port}${integrationWorkerPath}`,
      requests: installedWorkerRequests(),
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
