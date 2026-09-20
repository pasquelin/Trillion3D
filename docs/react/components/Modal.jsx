import { useRef, useState } from 'react';
import { Button } from './UI.jsx';
/** Native dialog owns focus trapping, Escape and focus restoration; DaisyUI owns presentation. */
export function Modal({ title, triggerLabel, closeLabel, children, imageOnly = false }) {
  const dialog = useRef(null),
    [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          dialog.current.showModal();
        }}
      >
        {triggerLabel}
      </Button>
      <dialog ref={dialog} className="modal" aria-label={title} onClose={() => setOpen(false)}>
        <div
          className={
            imageOnly
              ? 'modal-box relative w-auto max-w-none max-h-none overflow-hidden p-0'
              : 'modal-box w-11/12 max-w-none'
          }
        >
          <div
            className={
              imageOnly
                ? 'absolute right-2 top-2 z-50'
                : 'flex items-center justify-between gap-4 mb-4'
            }
          >
            {!imageOnly && <h2 className="text-xl font-semibold">{title}</h2>}
            <Button
              className={imageOnly ? 'bg-base-100' : undefined}
              aria-label={closeLabel}
              onClick={() => dialog.current.close()}
            >
              {closeLabel}
            </Button>
          </div>
          {open && (typeof children === 'function' ? children() : children)}
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label={closeLabel}>
            {closeLabel}
          </button>
        </form>
      </dialog>
    </>
  );
}
