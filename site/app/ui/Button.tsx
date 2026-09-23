import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface Look {
  variant?: Variant;
  size?: Size;
  /** A round icon button, its label carried by `aria-label`. */
  circle?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};
const sizes: Record<Size, string> = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };

const look = ({ variant = 'ghost', size = 'md', circle = false }: Look, className = '') =>
  `btn ${variants[variant]} ${sizes[size]} ${circle ? 'btn-circle' : ''} ${className}`;

type ButtonProps = ComponentPropsWithoutRef<'button'> & Look;

/** The DaisyUI button, the one clickable action of the site. */
export function Button({ variant, size, circle, className, ...props }: ButtonProps) {
  return <button type="button" className={look({ variant, size, circle }, className)} {...props} />;
}

type LinkButtonProps = ComponentPropsWithoutRef<'a'> & Look;

/** Actions side by side, wrapping on narrow screens. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

/** A link that reads as a button: a route the reader goes to, drawn as an action. */
export function LinkButton({ variant, size, circle, className, ...props }: LinkButtonProps) {
  return <a className={look({ variant, size, circle }, className)} {...props} />;
}
