/**
 * What a module worker's scope holds that its code uses: the messages it hears (`In`) and posts
 * (`Out`), and what it transfers with them (`Move`, buffers by default). The repository's DOM library does not type a dedicated worker's scope; this shape is
 * all the worker files, and the port a thread speaks to them through, need.
 */
export type WorkerScope<In = unknown, Out = unknown, Move = ArrayBuffer> = {
  onmessage: ((event: { data: In }) => void) | null
  postMessage(message: Out, transfer?: Move[]): void
}
