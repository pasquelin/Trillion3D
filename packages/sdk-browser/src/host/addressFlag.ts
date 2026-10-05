/**
 * A question asked of the page's address, `ask` answering it from its parameters: the address is
 * reread on every call — the flags are queried per frame — but parsed only once per string.
 * `absent` where there is no address (a worker, Node).
 */
export function addressParam<T>(ask: (params: URLSearchParams) => T, absent: T) {
  let search: string | undefined,
    answer = absent;
  return () => {
    const now = typeof location === 'undefined' ? undefined : location.search;
    if (now !== search) {
      search = now;
      answer = now === undefined ? absent : ask(new URLSearchParams(now));
    }
    return answer;
  };
}

/** A yes-or-no question asked of the page's address (`addressParam`): `false` with none. */
export const addressFlag = (ask: (params: URLSearchParams) => boolean) => addressParam(ask, false);

/** `ask`'s answer at the first question, held: everything built after it gets the same. */
export function heldOnce<T>(ask: () => T) {
  let held: { value: T } | undefined;
  return () => (held ??= { value: ask() }).value;
}
