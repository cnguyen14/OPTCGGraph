interface BadgeProps {
  variant?: 'default' | 'red' | 'blue' | 'green' | 'purple' | 'gold' | 'yellow';
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: 'bg-white/10 text-text-secondary border-white/10',
  red: 'bg-card-red/15 text-card-red border-card-red/20',
  blue: 'bg-card-blue/15 text-card-blue border-card-blue/20',
  green: 'bg-card-green/15 text-card-green border-card-green/20',
  purple: 'bg-card-purple/15 text-card-purple border-card-purple/20',
  gold: 'bg-op-gold/15 text-op-gold border-op-gold/20',
  yellow: 'bg-card-yellow/15 text-card-yellow border-card-yellow/20',
};

export default function Badge({ variant = 'default', className = '', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
