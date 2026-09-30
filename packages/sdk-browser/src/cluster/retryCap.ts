/** The longest wait a `Retry-After` gets, in ms. Only a whole-file read waits (a model's manifest,
 *  tables, binary, images, texture levels, lights; some without an abort signal), while a user
 *  watches the model load: past ten seconds a named failure serves them better than an open wait.
 *  A streamed page or a physics tile asks once (`ONE_REQUEST`) and never waits. */
export const RETRY_AFTER_CAP_MS = 10_000;
