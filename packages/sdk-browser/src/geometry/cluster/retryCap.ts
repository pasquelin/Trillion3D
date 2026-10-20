/** The longest wait a `Retry-After` gets, in ms. A whole-file read (a model's manifest, tables,
 *  binary, images, texture levels, lights; some without an abort signal) waits it between its two
 *  requests, while a user watches the model load: past ten seconds a named failure serves them
 *  better than an open wait. A streamed page asks once (`ONE_REQUEST`): the wait the server asked
 *  rides on its refusal (`retryAfterOf`), and its failure waits at least that long
 *  (`../streaming/failures.ts`). */
export const RETRY_AFTER_CAP_MS = 10_000
