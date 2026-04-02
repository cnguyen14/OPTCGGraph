import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, icon, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-medium text-text-secondary">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={`w-full bg-surface-1 border border-glass-border rounded-[var(--radius-glass-sm)] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all duration-[var(--duration-fast)] focus:bg-surface-2 focus:border-op-ocean focus:ring-1 focus:ring-op-ocean/30 ${icon ? 'pl-9' : ''} ${className}`}
            {...props}
          />
        </div>
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
