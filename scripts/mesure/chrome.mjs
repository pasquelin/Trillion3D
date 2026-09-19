// System Chrome, launched in a uniform way for the benchmark, oracle, and rendering proofs.
//
// Playwright locates it via channel (`channel: 'chrome'`) on Windows, macOS, or Linux:
// no path is hardcoded here, and a machine without Chrome installed receives Playwright's error,
// which names what is missing. The system Chrome is launched, never Playwright's Chromium:
// measurements and proofs run on the browser used by end users.
import { chromium } from 'playwright';

/**
 * Launches system Chrome. `options` are those of `chromium.launch` — `headless`, `args` —,
 * with the channel set here and nowhere else.
 */
export function launchChrome(options = {}) {
  return chromium.launch({ channel: 'chrome', ...options });
}
