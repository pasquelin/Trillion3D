import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

interface FabAction {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  /** For a switch: whether it is on. */
  pressed?: boolean;
}

interface FabProps {
  label: string;
  actions: FabAction[];
}

/** The DaisyUI floating action button: one round button in the corner that opens onto the
 * page's actions, each a round button with its name beside it. */
export function Fab({ label, actions }: FabProps) {
  return (
    <div className="fab" data-fab>
      <div
        tabIndex={0}
        role="button"
        aria-label={label}
        className="btn btn-lg btn-circle btn-primary"
      >
        <Icon name="plus" />
      </div>
      {actions.map((action) => (
        <div key={action.id}>
          <span aria-hidden="true">{action.label}</span>
          <button
            type="button"
            className="btn btn-lg btn-circle"
            aria-label={action.label}
            aria-pressed={action.pressed}
            onClick={action.onClick}
          >
            <Icon name={action.icon} />
          </button>
        </div>
      ))}
    </div>
  );
}
