interface Tab {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export default function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <nav className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-glass-sm)] text-sm font-medium transition-all duration-[var(--duration-fast)] cursor-pointer ${
            active === tab.key
              ? 'bg-surface-4 text-text-primary border-b-2 border-op-gold shadow-[0_2px_8px_rgba(209,188,0,0.15)]'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
