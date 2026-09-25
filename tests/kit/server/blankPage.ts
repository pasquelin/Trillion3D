import type { Server } from 'node:http';
import { contentType, listen, reply, staticServer } from '../../../scripts/static-server.ts';

/**
 * A server that answers every request with an empty HTML page titled `title`: the origin a GPU
 * proof opens before it injects its own modules. With a `script`, the page loads it from
 * `/page.js`. Resolves once it listens, with the port it got.
 */
export async function blankPageServer(
  title: string,
  script: string | null = null,
): Promise<{ server: Server; port: number }> {
  const tag = script ? '<script src="/page.js"></script>' : '';
  const html = `<!doctype html><title>${title}</title>${tag}`;
  const server = staticServer({
    answer: (request, response) =>
      script && request.url === '/page.js'
        ? reply(response, 200, contentType('.js'), script)
        : reply(response, 200, contentType('.html'), html),
  });
  return { server, port: await listen(server) };
}
