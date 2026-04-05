import { Tabs } from '../components/ui';

interface AppLayoutProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  chatSidebar?: React.ReactNode;
}

const NAV_TABS = [
  { key: 'cards', label: 'Cards' },
  { key: 'deck', label: 'Deck Builder' },
  { key: 'mydecks', label: 'My Decks' },
  { key: 'meta', label: 'Meta Explorer' },
  { key: 'simulator', label: 'Simulator' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
];

export default function AppLayout({ activeTab, onTabChange, children, chatSidebar }: AppLayoutProps) {
  return (
    <div className="relative h-screen flex flex-col bg-surface-base text-text-primary">
      {/* Map background — subtle parchment overlay across all pages */}
      <div
        className="absolute inset-0 opacity-[0.04] bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: 'url(/images/op-world-map.jpg)' }}
      />

      {/* Glass Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 bg-surface-2 backdrop-blur-[12px] border-b border-glass-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onTabChange('landing')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
          >
            <img
              src="/images/logo-op-white.png"
              alt="One Piece Card Game"
              className="h-6 object-contain"
            />
            <span className="font-[var(--font-display)] text-lg tracking-wide">
              <span className="text-text-primary">GRAND </span>
              <span className="text-op-gold">DECK</span>
            </span>
          </button>
          <span className="text-xs text-text-muted bg-surface-3 rounded-full px-2.5 py-0.5 font-medium">
            v0.1
          </span>
        </div>

        <Tabs tabs={NAV_TABS} active={activeTab} onChange={onTabChange} />
      </header>

      {/* Main Content + Chat Sidebar */}
      <div className="relative z-10 flex-1 flex gap-3 p-3 overflow-hidden">
        <main className="flex-1 overflow-y-auto min-w-0 min-h-0">
          {children}
        </main>
        {/* Chat sidebar — collapsed tab in flow, overlay when expanded */}
        {chatSidebar}
      </div>
    </div>
  );
}
