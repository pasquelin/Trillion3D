import type { PresentRect } from '../../gpu/core/presentAt.ts';

type Region = { rect: () => PresentRect; surface: HTMLElement };

/** Routes existing controllers through rectangles of one canvas; a drag keeps the region it began in. */
export function createViewInput(canvas: HTMLCanvasElement) {
  const regions: Region[] = [],
    pointers = new Map<number, { region: Region }>();
  let focused: Region | undefined;
  const touchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  const hit = (event: MouseEvent) => {
    const box = canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left) * canvas.clientWidth) / box.width;
    const y = ((event.clientY - box.top) * canvas.clientHeight) / box.height;
    return regions.findLast(({ rect }) => {
      const r = rect();
      return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
    });
  };
  const down = (event: PointerEvent) => {
    focused = hit(event);
    if (focused) pointers.set(event.pointerId, { region: focused });
  };
  canvas.addEventListener('pointerdown', down, true);
  return {
    /** A controller surface whose dimensions, pointer and keyboard input belong to this region. */
    region(rect: () => PresentRect) {
      const listeners: {
        target: EventTarget;
        type: string;
        listener: EventListenerOrEventListenerObject;
        wrapped: EventListener;
        capture: boolean;
      }[] = [];
      const region = { rect } as Region;
      const owner = canvas.ownerDocument;
      const bind = (target: object, key: PropertyKey) => {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      };
      const events = (target: EventTarget, document: boolean) => ({
        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions | boolean,
        ) {
          const capture = typeof options === 'boolean' ? options : !!options?.capture;
          if (
            listeners.some(
              (row) =>
                row.target === target &&
                row.type === type &&
                row.listener === listener &&
                row.capture === capture,
            )
          )
            return;
          const wrapped = (event: Event) => {
            const pointer = event as PointerEvent;
            const accepts = document
              ? type.startsWith('pointer')
                ? pointers.get(pointer.pointerId)?.region === region ||
                  (owner.pointerLockElement === canvas && focused === region)
                : type !== 'keydown' || focused === region
              : type.startsWith('pointer')
                ? pointers.get(pointer.pointerId)?.region === region ||
                  (owner.pointerLockElement === canvas && focused === region)
                : hit(event as MouseEvent) === region;
            if (!accepts) return;
            if (typeof listener === 'function') listener.call(region.surface, event);
            else listener.handleEvent(event);
            if (type === 'pointerup' || type === 'pointercancel') {
              const held = pointers.get(pointer.pointerId);
              queueMicrotask(() => {
                if (pointers.get(pointer.pointerId) === held) pointers.delete(pointer.pointerId);
              });
            }
          };
          listeners.push({ target, type, listener, wrapped, capture });
          target.addEventListener(type, wrapped, options);
        },
        removeEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: EventListenerOptions | boolean,
        ) {
          const at = listeners.findIndex(
            (row) =>
              row.target === target &&
              row.type === type &&
              row.listener === listener &&
              row.capture === (typeof options === 'boolean' ? options : !!options?.capture),
          );
          if (at < 0) return;
          target.removeEventListener(type, listeners[at].wrapped, options);
          listeners.splice(at, 1);
        },
      });
      const docEvents = events(owner, true),
        surfaceEvents = events(canvas, false);
      const document = new Proxy(owner, {
        get(target, key) {
          if (key === 'pointerLockElement')
            return target.pointerLockElement === canvas && focused === region
              ? region.surface
              : target.pointerLockElement;
          if (key in docEvents) return docEvents[key as keyof typeof docEvents];
          return bind(target, key);
        },
      });
      const style = { touchAction: 'none' };
      region.surface = new Proxy(canvas, {
        get(target, key) {
          if (key in surfaceEvents) return surfaceEvents[key as keyof typeof surfaceEvents];
          if (key === 'ownerDocument') return document;
          if (key === 'style') return style;
          if (key === 'clientWidth') return rect().width;
          if (key === 'clientHeight') return rect().height;
          if (key === 'getBoundingClientRect')
            return () => {
              const box = canvas.getBoundingClientRect(),
                r = rect();
              const sx = box.width / canvas.clientWidth,
                sy = box.height / canvas.clientHeight;
              return new DOMRect(
                box.left + r.x * sx,
                box.top + r.y * sy,
                r.width * sx,
                r.height * sy,
              );
            };
          return bind(target, key);
        },
      });
      regions.push(region);
      focused ??= region;
      return {
        surface: region.surface,
        dispose() {
          const at = regions.indexOf(region);
          if (at < 0) return;
          regions.splice(at, 1);
          for (const row of listeners.splice(0))
            row.target.removeEventListener(row.type, row.wrapped, row.capture);
          for (const [id, held] of pointers) if (held.region === region) pointers.delete(id);
          if (focused === region) focused = regions[0];
        },
      };
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down, true);
      canvas.style.touchAction = touchAction;
      pointers.clear();
      regions.length = 0;
    },
  };
}
