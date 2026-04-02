import { forwardRef } from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, className = '', children, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-medium text-text-secondary">{label}</label>
        )}
        <select
          ref={ref}
          className={`w-full bg-surface-1 border border-glass-border rounded-[var(--radius-glass-sm)] px-3 py-2 text-sm text-text-primary outline-none transition-all duration-[var(--duration-fast)] focus:bg-surface-2 focus:border-op-ocean focus:ring-1 focus:ring-op-ocean/30 cursor-pointer ${className}`}
          {...props}
        >
          {children}
        </select>
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
