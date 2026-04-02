interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: 'close' | 'chevron-down' | 'search' | 'menu' | 'plus' | 'minus' | 'expand' | 'collapse';
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'glass';
}

const icons: Record<string, React.ReactNode> = {
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  'chevron-down': (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx={11} cy={11} r={8} />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M4 14h6v6M14 4h6v6M20 4l-7 7M4 20l7-7" />
    </svg>
  ),
};

const sizeStyles: Record<string, { button: string; icon: string }> = {
  sm: { button: 'w-6 h-6', icon: 'w-3.5 h-3.5' },
  md: { button: 'w-8 h-8', icon: 'w-4 h-4' },
  lg: { button: 'w-10 h-10', icon: 'w-5 h-5' },
};

const variantStyles: Record<string, string> = {
  ghost: 'bg-transparent hover:bg-surface-2 text-text-secondary hover:text-text-primary',
  glass: 'bg-surface-1 hover:bg-surface-2 text-text-secondary hover:text-text-primary border border-glass-border',
};

export default function IconButton({
  icon,
  size = 'md',
  variant = 'ghost',
  className = '',
  ...props
}: IconButtonProps) {
  const s = sizeStyles[size];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-[var(--radius-glass-sm)] transition-all duration-[var(--duration-fast)] cursor-pointer ${s.button} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      <span className={s.icon}>{icons[icon]}</span>
    </button>
  );
}
