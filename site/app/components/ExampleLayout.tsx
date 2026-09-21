import type { ReactNode } from 'react';

interface ExampleLayoutProps {
  left: ReactNode;
  right: ReactNode;
  footer?: ReactNode;
}

export function ExampleLayout({ left, right, footer }: ExampleLayoutProps) {
  return (
    <div className="example-layout">
      <div className="example-learn min-w-0 space-y-4">{left}</div>
      <div className="example-observe min-w-0 space-y-4">{right}</div>
      {footer && <div className="example-footer min-w-0">{footer}</div>}
    </div>
  );
}
