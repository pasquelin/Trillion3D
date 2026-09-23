import { createServer, type Server } from 'node:http';

/**
 * A server that answers every request with an empty HTML page titled `title`: the origin a GPU
 * proof opens before it injects its own modules. Resolves once it listens, with the port it got.
 */
export async function blankPageServer(title: string): Promise<{ server: Server; port: number }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><title>${title}</title>`);
  });
  await new Promise<void>((ready: () => void, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('HTTP listener unavailable');
  return { server, port: address.port };
}
