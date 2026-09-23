/**
 * `changed` run at most once per animation frame however often a drag asks for it, with the
 * values of that moment, and at once when `now`: a slider or a colour picker dragged fires an
 * `input` per pointer move, and each run may write a material the world then resolves again.
 */
export function perFrame(changed: () => void, schedule: (run: () => void) => unknown) {
  let queued = false;
  return (now = false) => {
    if (now) {
      queued = false;
      return changed();
    }
    if (queued) return;
    queued = true;
    schedule(() => {
      if (!queued) return;
      queued = false;
      changed();
    });
  };
}
