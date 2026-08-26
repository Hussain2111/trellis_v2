/**
 * A small hand-drawn icon set rather than a dependency.
 *
 * Six icons do not justify pulling in an icon library, and a library's default
 * weight rarely matches a type scale it knows nothing about. These are all
 * 24×24, 1.6-weight strokes, `currentColor` — so they take the colour of
 * whatever they sit inside and need no per-theme handling.
 */
type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? 'size-5'}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
    </Svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8l-4 2.5.9-3.6A7.5 7.5 0 1 1 20 12Z" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  );
}

/**
 * A cog, not a sun.
 *
 * The first version was a circle with eight radial spokes, which is the
 * standard way to draw a sun and was read as one. A gear reads as a gear
 * because of the teeth — blocks around the rim, not lines radiating off it.
 */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.1 14.4a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.96 1.46v.16a1.9 1.9 0 1 1-3.8 0v-.08a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.96H3.3a1.9 1.9 0 1 1 0-3.8h.08a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.05a1.9 1.9 0 1 1 2.7-2.7l.05.06a1.6 1.6 0 0 0 1.77.32h.07a1.6 1.6 0 0 0 .96-1.46V3.3a1.9 1.9 0 1 1 3.8 0v.08a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.05-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.05a1.6 1.6 0 0 0-.32 1.77v.07a1.6 1.6 0 0 0 1.46.96h.16a1.9 1.9 0 1 1 0 3.8h-.08a1.6 1.6 0 0 0-1.46.97Z" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.5 7" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}
