/**
 * A question asked of the page's address, `ask` answering it from its parameters: the address is
 * reread on every call — the flags are queried per frame — but parsed only once per string.
 * `false` where there is no address (a worker, Node).
 */
export function addressFlag(ask: (params: URLSearchParams) => boolean) {
  let search: string | undefined,
    on = false;
  return () => {
    const now = typeof location === 'undefined' ? undefined : location.search;
    if (now !== search) {
      search = now;
      on = now !== undefined && ask(new URLSearchParams(now));
    }
    return on;
  };
}
