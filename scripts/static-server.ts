// The one local static server: the docs portal, the installed-package proof, the bench harness and
// the blank GPU pages all answer through it. What sets them apart is an option, never a copy.
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
};

/** The content type of a file ending in `extension`, naming utf-8 when `charset` lists it. */
export function contentType(extension: string, charset: readonly string[] = []): string {
  const type = TYPES[extension] ?? 'application/octet-stream';
  return charset.includes(extension) ? `${type}; charset=utf-8` : type;
}

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
  /** Headers on every file served, besides its type and length. */
  fileHeaders?: Record<string, string>;
  /** Extensions whose content type names utf-8. */
  charset?: readonly string[];
  /** A directory answers with its `index.html`. */
  index?: boolean;
  /** The status of a path that leaves its mount or that `refuse` names (403 by default). */
  refused?: number;
  /** Whether a file inside its mount is refused all the same. */
  refuse?: (file: string) => boolean;
  /** Answers a request before any file is looked for; returns whether it did. */
  answer?: (request: IncomingMessage, response: ServerResponse, url: URL) => boolean;
  /** The JavaScript a file is served as, or `undefined` to serve its bytes. */
  transform?: (file: string) => string | undefined;
}

async function serveFile(
  mount: Mount,
  path: string,
  response: ServerResponse,
  { fileHeaders, charset, index, refused = 403, refuse, transform }: StaticOptions,
) {
  let file = fileUnder(mount.dir, path);
  if (file === null || refuse?.(file)) return reply(response, refused);
  let found = await stat(file);
  if (index && found.isDirectory()) found = await stat((file = resolve(file, 'index.html')));
  if (!found.isFile()) return reply(response, 404);
  const text = transform?.(file);
  const body = text === undefined ? undefined : Buffer.from(text);
  // The file is opened before the headers leave, so a file it cannot read is still a 404.
  const stream = body ? undefined : createReadStream(file);
  if (stream) await once(stream, 'open');
  response.writeHead(200, {
    'content-type': contentType(body ? '.js' : extname(file), charset),
    'content-length': body ? body.length : found.size,
    ...fileHeaders,
  });
  // A read error past the headers destroys the response, so the socket never waits on it.
  if (stream) pipeline(stream, response, () => {});
  else response.end(body);
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
    serveFile(mount, url.pathname.slice(mount.prefix.length), response, options).catch(() => {
      if (!response.headersSent) reply(response, 404);
    });
  });
}

/** Listens on the loopback interface (`port` 0 picks a free one) and resolves with the port. */
export function listen(server: Server, port = 0): Promise<number> {
  return new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      // A local server binds an IP address, never a pipe.
      if (address && typeof address !== 'string') ready(address.port);
      else reject(new Error('server is not listening on a port'));
    });
  });
}
