interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const variantStyles: Record<string, string> = {
  primary:
    'bg-op-red hover:bg-op-red-light text-white shadow-glow-red hover:shadow-[0_0_40px_rgba(185,29,34,0.4)]',
  secondary:
    'bg-surface-2 hover:bg-surface-3 text-text-primary border border-glass-border hover:border-glass-border-hover backdrop-blur-[12px]',
  ghost:
    'bg-transparent hover:bg-surface-2 text-text-secondary hover:text-text-primary',
  danger:
    'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 hover:border-red-500/40',
  success:
    'bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/20 hover:border-green-500/40',
};

const sizeStyles: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[var(--radius-glass-sm)]',
  md: 'px-4 py-2 text-sm rounded-[var(--radius-glass-sm)]',
  lg: 'px-8 py-3 text-base font-semibold rounded-[var(--radius-glass)]',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium transition-all duration-[var(--duration-fast)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
