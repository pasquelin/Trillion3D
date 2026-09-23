import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface LoadingProps extends ComponentPropsWithoutRef<'div'> {
  label?: ReactNode;
}

export function Loading({ label, ...props }: LoadingProps) {
  return (
    <div
      role="status"
      className="absolute inset-0 z-10 grid place-items-center bg-base-300"
      {...props}
    >
      <span className="grid justify-items-center gap-3 text-sm">
        <span className="loading loading-spinner loading-md" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}
