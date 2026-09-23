/**
 * How long a session may prepare in silence. Not a limit on the work, which goes on, and not a
 * value any scene tuned: the moment a page left with an empty canvas is told where the opening
 * waits. It stands for a human's patience before a blank view reads as broken; any value from a
 * few seconds to a minute says the same thing, only sooner or later.
 */
const OPENING_REPORT_MS = 10_000;

/** A timer that never holds a Node process open on its own; a browser has no such notion. */
function later(report: () => void, delayMs: number) {
  const timer = setTimeout(report, delayMs);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/**
 * Watches one session's opening: `note` records each step it reports, and if `done` has not been
 * called after `delayMs`, the console is told once, with the step the opening is waiting in. An
 * opening that never settles — a promise nothing resolves — is then named rather than silent.
 */
export function watchOpening(manifestUrl: string, delayMs = OPENING_REPORT_MS) {
  let step = 'start';
  const timer = later(
    () =>
      console.warn(
        `[web-geometry] ${manifestUrl || 'world'}: the session has not opened after ` +
          `${delayMs / 1000} s; last step: ${step}`,
      ),
    delayMs,
  );
  return {
    note(phase: string, message: string) {
      step = `${phase} (${message})`;
    },
    done() {
      clearTimeout(timer);
    },
  };
}

/**
 * Watches a world's first frame: if none was drawn `delayMs` after its creation, `stage` says
 * where the world stands — `null` when there is nothing to report, an empty scene or a frame
 * already drawn, a world disposed — and the console is told once: a scene that holds something
 * and has drawn nothing says so, rather than leaving a blank canvas alone.
 */
export function watchFirstFrame(stage: () => string | null, delayMs = OPENING_REPORT_MS) {
  later(() => {
    const at = stage();
    if (at)
      console.warn(
        `[web-geometry] no frame drawn ${delayMs / 1000} s after the world began: ${at}`,
      );
  }, delayMs);
}
