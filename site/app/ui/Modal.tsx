import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  /** `wide` fills most of the screen; `image` shows its content alone, edge to edge. */
  size?: 'normal' | 'wide' | 'image';
  children: ReactNode;
}

const boxes = {
  normal: 'modal-box',
  wide: 'modal-box flex max-h-[90dvh] w-11/12 max-w-6xl flex-col',
  image: 'modal-box relative w-auto max-w-none max-h-none overflow-hidden p-0',
};

/** The DaisyUI modal over the native dialog, which owns the focus trap, Escape and the return
 * of focus. React owns whether it is open; the content is mounted only while it is, and the
 * element marked `data-autofocus` takes the focus when it opens. */
export function Modal({ open, onClose, title, closeLabel, size = 'normal', children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) {
      element?.showModal();
      element?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && element?.open) element.close();
  }, [open]);
  const image = size === 'image';
  return (
    <dialog ref={dialog} className="modal" aria-label={title} onClose={onClose}>
      <div className={boxes[size]}>
        <div className={image ? 'absolute right-2 top-2 z-50' : 'mb-4 flex items-center gap-4'}>
          {!image && <h2 className="flex-1 text-xl font-semibold">{title}</h2>}
          <Button size="sm" className={image ? 'bg-base-100' : ''} onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
        {open && children}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label={closeLabel}>
          {closeLabel}
        </button>
      </form>
    </dialog>
  );
}

interface ModalTriggerProps extends Omit<ModalProps, 'open' | 'onClose'> {
  label: ReactNode;
}

/** A button that opens its own modal. */
export function ModalTrigger({ label, ...modal }: ModalTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal {...modal} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
