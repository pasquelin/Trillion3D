// The one local static server: the docs portal, the installed-package proof, the bench harness and
// the blank GPU pages all answer through it. What sets them apart is an option, never a copy.
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { constants, createBrotliCompress } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
};

/** The content type of a file ending in `extension`; text is always utf-8. */
export const contentType = (extension: string): string =>
  TYPES[extension] ?? 'application/octet-stream';

/** A URL prefix served from a directory. */
export type Mount = { prefix: string; dir: string };

/** The file the URL-encoded `path` names under `dir`, or `null` when it leaves `dir`. */
export function fileUnder(dir: string, path: string): string | null {
  const base = resolve(dir);
  const file = resolve(base, `./${decodeURIComponent(path)}`);
  return file === base || file.startsWith(base + sep) ? file : null;
}

/** Ends `response` with `status`, and `body` of `type` when given; true, as an `answer` returns. */
export function reply(response: ServerResponse, status: number, type?: string, body?: string) {
  response.writeHead(status, type ? { 'content-type': type } : {}).end(body);
  return true;
}

/** What sets one server apart. Without options it answers 404 to everything. */
export interface StaticOptions {
  mounts?: Mount[];
  /** Headers on every response. */
  headers?: Record<string, string>;
  /** Whether a file inside its mount is refused all the same, as one outside it is (403). */
  refuse?: (file: string) => boolean;
  /** Answers a request before any file is looked for; returns whether it did. */
  answer?: (request: IncomingMessage, response: ServerResponse, url: URL) => boolean;
  /** The text a file is served as and its content type, or `undefined` to serve its bytes. */
  transform?: (file: string) => { type: string; text: string } | undefined;
  /** Whether a file is sent brotli-encoded to a request that accepts it (`Content-Encoding: br`):
   *  the client reads the file's own bytes once it decodes them. */
  compress?: (file: string) => boolean;
}

/** Whether an `Accept-Encoding` header accepts brotli: named, and not with a zero weight. */
export function acceptsBrotli(header: string | undefined) {
  return (header ?? '').split(',').some((entry) => {
    const [name, ...parameters] = entry.split(';').map((part) => part.trim().toLowerCase());
    return name === 'br' && !parameters.some((p) => /^q=0(\.0*)?$/.test(p));
  });
}

/** Brotli as a local server can afford per request: quality 5 of 11 compresses tens of megabytes a
 *  second; a published tree carries its files compressed at the top quality (`pages.yml`). */
const ON_THE_FLY = { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } };

/** Serves the file `path` names under `dir`, a directory by its `index.html`. */
async function serveFile(
  dir: string,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  { refuse, transform, compress }: StaticOptions,
) {
  let file = fileUnder(dir, path);
  if (file === null || refuse?.(file)) return reply(response, 403);
  let found = await stat(file);
  if (found.isDirectory()) found = await stat((file = resolve(file, 'index.html')));
  if (!found.isFile()) return reply(response, 404);
  const served = transform?.(file);
  if (served) return reply(response, 200, served.type, served.text);
  // The file is opened before the headers leave, so a file it cannot read is still a 404.
  const stream = createReadStream(file);
  await once(stream, 'open');
  const type = contentType(extname(file));
  // A read error past the headers destroys the response, so the socket never waits on it.
  if (compress?.(file)) {
    const vary = { 'content-type': type, vary: 'accept-encoding' };
    if (acceptsBrotli(request.headers['accept-encoding'])) {
      response.writeHead(200, { ...vary, 'content-encoding': 'br' });
      return pipeline(stream, createBrotliCompress(ON_THE_FLY), response, () => {});
    }
    response.writeHead(200, { ...vary, 'content-length': found.size });
  } else response.writeHead(200, { 'content-type': type, 'content-length': found.size });
  pipeline(stream, response, () => {});
}

/** A server over `options.mounts`; a path no mount takes, or no file answers, is a 404. */
export function staticServer(options: StaticOptions = {}): Server {
  const { mounts = [], headers = {}, answer } = options;
  const every = Object.entries(headers);
  return createServer((request, response) => {
    for (const [name, value] of every) response.setHeader(name, value);
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (answer?.(request, response, url)) return;
    const mount = mounts.find(({ prefix }) => url.pathname.startsWith(prefix));
    if (!mount) return reply(response, 404);
    const path = url.pathname.slice(mount.prefix.length);
    serveFile(mount.dir, path, request, response, options).catch((error: NodeJS.ErrnoException) => {
      // A missing file is an ordinary 404; anything else (a transform that throws, a file it
      // may not read) is still a 404, but said, so the page's failed import has its cause.
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        console.error(`static server: ${url.pathname}:`, error);
      if (!response.headersSent) reply(response, 404);
    });
  });
}

/** Listens on the loopback interface (`port` 0 picks a free one) and resolves with the port. */
export function listen(server: Server, port = 0): Promise<number> {
  return new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      // Only a failure to listen rejects; a later server error is not swallowed here.
      server.off('error', reject);
      // A server bound to an IP address has an `AddressInfo`, never a pipe name.
      ready((server.address() as AddressInfo).port);
    });
  });
}
