import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { keepsScroll, PORTAL, stepFrame } from './frameFocus.ts';
import type { FrameEvent } from './frameFocus.ts';
import { typing } from './typing.ts';

/** When a demo's frame takes the keyboard: as soon as it loads, where the demo is the page, or on
 * the first press inside it, where the page around must keep its scrolling keys until then. */
export type FrameKeyboard = 'load' | 'press';

/** Whether a wheel over `target` scrolls something of the demo's own, a panel or a list. */
const scrollsInside = (target: EventTarget | null, view: Window) => {
  for (let node = target as Element | null; node; node = node.parentElement) {
    const { overflowY } = view.getComputedStyle(node);
    if (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight) return true;
  }
  return false;
};

/**
 * Wires one loaded document of a frame to the keyboard, through `stepFrame`. A press inside hands
 * the focus to the frame (a canvas that cancels its pointerdown would leave it on the portal),
 * and `take` hands it at once. While the demo holds the keyboard, the keys and the wheel that
 * would scroll the portal stay the demo's; a drag started inside selects nothing outside; the
 * keys still down when the focus leaves are released, so none stays stuck. Returns the unbinding.
 */
function bindFrame(frame: HTMLIFrameElement, take: boolean, held: (on: boolean) => void) {
  const view = frame.contentWindow;
  const doc = frame.contentDocument;
  const portal = frame.ownerDocument;
  if (!view || !doc) return () => {};
  const bound = new AbortController();
  const listen = { signal: bound.signal };
  let focus = PORTAL;
  const send = (event: FrameEvent) => {
    const [next, act] = stepFrame(focus, event);
    focus = next;
    if (act === 'focus') {
      frame.focus();
      view.focus();
    } else if (act === 'release') {
      frame.blur();
      portal.defaultView?.focus();
    }
    held(focus.state !== 'portal');
  };
  const down = new Map<string, KeyboardEventInit>();
  // The event is made in the frame's realm, as the example's own would be.
  const { KeyboardEvent: FrameKey } = view as Window & typeof globalThis;
  const releaseKeys = () => {
    const keys = [...down.values()];
    down.clear();
    for (const init of keys) doc.dispatchEvent(new FrameKey('keyup', { ...init, bubbles: true }));
  };
  const dragEnd = () => delete portal.documentElement.dataset.demoDrag;
  const press = () => {
    portal.documentElement.dataset.demoDrag = '';
    send('take');
  };
  view.addEventListener('pointerdown', press, { ...listen, capture: true });
  for (const end of ['pointerup', 'pointercancel'])
    for (const target of [view, portal.defaultView]) target?.addEventListener(end, dragEnd, listen);
  view.addEventListener('focus', () => send('focus'), listen);
  view.addEventListener('blur', () => (dragEnd(), releaseKeys(), send('blur')), listen);
  const lockChange = () => send(doc.pointerLockElement ? 'lock' : 'unlock');
  doc.addEventListener('pointerlockchange', lockChange, listen);
  // On the window, after the example's own listeners on its document.
  const keydown = (event: KeyboardEvent) => {
    if (!event.repeat) down.set(event.code, { key: event.key, code: event.code });
    if (event.key === 'Escape' && !event.defaultPrevented) send('escape');
    else if (keepsScroll(event.key, event.target)) event.preventDefault();
  };
  const keyup = (event: KeyboardEvent) => {
    down.delete(event.code);
    if (event.key === 'Escape') send('escapeUp');
  };
  const wheel = (event: WheelEvent) => {
    if (focus.state !== 'portal' && !scrollsInside(event.target, view)) event.preventDefault();
  };
  view.addEventListener('keydown', keydown, listen);
  view.addEventListener('keyup', keyup, listen);
  view.addEventListener('wheel', wheel, { ...listen, passive: false });
  if (take) send('take');
  return () => {
    bound.abort();
    dragEnd();
    // A frame still on the page gives back its lock and its keys; a removed one lost them with it.
    if (!frame.isConnected) return;
    if (doc.pointerLockElement) doc.exitPointerLock();
    releaseKeys();
  };
}

/**
 * Keyboard focus for every frame that loads inside `host`, bound on its load — a restarted demo
 * is bound again — or at once when it had loaded before the host was watched, as after a reload
 * of the page. Returns whether a frame holds the keyboard; `mode` undefined leaves the host alone.
 * On load, a field or an editor that has the focus keeps it. Leaving the page ends any lock.
 */
export function useFrameFocus(host: RefObject<HTMLElement | null>, mode?: FrameKeyboard) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const node = host.current;
    if (!node || !mode) return;
    const bindings = new Map<Document, () => void>();
    const bind = (frame: HTMLIFrameElement) => {
      const doc = frame.contentDocument;
      if (!doc || bindings.has(doc)) return;
      // A restarted demo starts free: the frame it replaces may have gone without a blur.
      setHeld(false);
      bindings.set(doc, bindFrame(frame, mode === 'load' && !typing(), setHeld));
    };
    for (const frame of node.querySelectorAll('iframe')) {
      const doc = frame.contentDocument;
      if (doc?.readyState === 'complete' && doc.URL !== 'about:blank') bind(frame);
    }
    // A frame's load does not bubble; the host sees it on the way down.
    const loaded = ({ target }: Event) => {
      if (target instanceof HTMLIFrameElement) bind(target);
    };
    node.addEventListener('load', loaded, true);
    return () => {
      node.removeEventListener('load', loaded, true);
      for (const unbind of bindings.values()) unbind();
      setHeld(false);
    };
  }, [host, mode]);
  return held;
}
