interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'subtle' | 'heavy';
  hover?: boolean;
  children: React.ReactNode;
}

const variantClass = {
  default: 'glass',
  subtle: 'glass-subtle',
  heavy: 'glass-heavy',
} as const;

export default function GlassCard({
  variant = 'default',
  hover = false,
  className = '',
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`${variantClass[variant]} ${hover ? 'glass-hover' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
