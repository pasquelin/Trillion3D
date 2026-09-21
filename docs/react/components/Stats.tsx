import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface StatSlotProps extends ComponentPropsWithoutRef<'div'> {
  [key: `data-${string}`]: unknown;
}

interface StatProps {
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  valueProps?: StatSlotProps;
  descriptionProps?: StatSlotProps;
}

export function StatGroup({ children, className = '', ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={`stats stats-grid bg-base-300 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Stat({
  title,
  children,
  description,
  valueProps = {},
  descriptionProps = {},
}: StatProps) {
  return (
    <div className="stat min-w-0">
      <div className="stat-title whitespace-normal">{title}</div>
      <div className="stat-value whitespace-normal break-words" {...valueProps}>
        {children}
      </div>
      {description != null && (
        <div className="stat-desc whitespace-normal" {...descriptionProps}>
          {description}
        </div>
      )}
    </div>
  );
}
