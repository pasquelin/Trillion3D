import type { Page } from 'playwright';

/** Hear the same runtime and resource failures in the portal and example proofs.
 * Resource errors retain their URL; an HTTP status alone does not identify a page error. */
export function collectPageErrors(page: Page, hear: (error: string) => void) {
  page.on('pageerror', (error) => hear(error.message));
  page.on('console', (message) => {
    const text = message.text();
    const url = message.location().url;
    const leakedInfo =
      message.type() === 'info' &&
      (text.startsWith('[trillion3d]') || /\/runtime\/engine\.js(?:[?#]|$)/.test(url));
    if (leakedInfo) hear(`Engine console.info: ${text}`);
    else if (message.type() === 'error')
      hear(text.startsWith('Failed to load resource') ? `${text} ${url}` : text);
  });
}
