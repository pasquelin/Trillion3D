import { takesKeys } from './typing.ts';

/**
 * Who reads the keyboard when a demo is framed in the portal, as a state machine the frame's
 * events drive. `portal`: the portal's keys (search, pager, page scrolling) work. `demo`: the
 * frame's document has the focus, so every key goes to the example. `locked`: the example also
 * holds the pointer. The browser's Escape ends a lock and leaves the demo focused; one more
 * Escape, or a press outside, gives the keyboard back to the portal.
 */
type FrameState = 'portal' | 'demo' | 'locked';

export interface FrameFocus {
  state: FrameState;
  /** A lock has just ended: the Escape that ended it, if the browser delivers it, is not a second. */
  unlocking: boolean;
}

/** What reaches the machine: a press inside the frame or a load that hands it the keyboard, the
 * frame's window gaining or losing the focus, a pointer lock taken or ended, an Escape pressed or
 * released inside. */
export type FrameEvent = 'take' | 'focus' | 'blur' | 'lock' | 'unlock' | 'escape' | 'escapeUp';

/** What the binding does on the way: hand the focus to the frame, or back to the portal. */
type FrameAct = 'focus' | 'release' | undefined;

export const PORTAL: FrameFocus = { state: 'portal', unlocking: false };

export function stepFrame(
  { state, unlocking }: FrameFocus,
  event: FrameEvent,
): [FrameFocus, FrameAct] {
  switch (event) {
    case 'take':
    case 'focus':
      return [
        { state: state === 'locked' ? 'locked' : 'demo', unlocking },
        event === 'take' ? 'focus' : undefined,
      ];
    case 'blur':
      return [PORTAL, undefined];
    case 'lock':
      return [{ state: 'locked', unlocking: false }, undefined];
    case 'unlock':
      return [
        { state: state === 'portal' ? 'portal' : 'demo', unlocking: state !== 'portal' },
        undefined,
      ];
    case 'escape':
      if (state !== 'demo' || unlocking) return [{ state, unlocking }, undefined];
      return [PORTAL, 'release'];
    case 'escapeUp':
      return [{ state, unlocking: false }, undefined];
  }
}

/** The keys that scroll a page: in a demo that holds the keyboard they are the demo's alone. */
const SCROLL_KEYS = new Set([
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/** Whether a key pressed in the demo must not scroll the page around it once the frame cannot:
 * a scrolling key the demo's own fields and buttons do not read. */
export const keepsScroll = (key: string, target: EventTarget | null) =>
  SCROLL_KEYS.has(key) &&
  !takesKeys(target) &&
  !/^(BUTTON|A|SUMMARY)$/.test((target as { tagName?: string } | null)?.tagName ?? '');
