import { Card } from './UI.jsx';

/** A titled page section with the shared card surface and heading hierarchy. */
export function Section({ title, children, className = '', ...props }) {
  return (
    <Card title={title} className={className} {...props}>
      {children}
    </Card>
  );
}
