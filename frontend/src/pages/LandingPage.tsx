import { Button } from '../components/ui';

interface LandingPageProps {
  onNavigate: (tab: string) => void;
}

const FLOATING_CARDS = [
  { src: '/images/landing/card01.webp', className: 'floating-card floating-card-1' },
  { src: '/images/landing/card03.webp', className: 'floating-card floating-card-3' },
  { src: '/images/landing/card04.webp', className: 'floating-card floating-card-4' },
  { src: '/images/landing/card06.webp', className: 'floating-card floating-card-6' },
];

const FEATURES = [
  {
    title: 'Card Explorer',
    description: 'Browse 2000+ cards with advanced filters, synergy graphs, and detailed card data.',
    tab: 'cards',
    cost: '1',
    power: '2000+',
    type: 'CHARACTER',
    color: '#3b82f6',
    colorName: 'Blue',
    icon: (
      <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <circle cx={11} cy={11} r={7} />
        <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        <circle cx={11} cy={11} r={3} strokeDasharray="2 2" />
      </svg>
    ),
  },
  {
    title: 'Deck Builder',
    description: 'AI-assisted deck building with real-time synergy maps and validation.',
    tab: 'deck',
    cost: '3',
    power: '5000',
    type: 'CHARACTER',
    color: '#d1bc00',
    colorName: 'Gold',
    icon: (
      <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <rect x={3} y={3} width={7} height={10} rx={1} />
        <rect x={14} y={3} width={7} height={10} rx={1} />
        <rect x={8.5} y={6} width={7} height={10} rx={1} />
        <path d="M6.5 16v4M17.5 16v4M12 19v2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Battle Simulator',
    description: 'Test your deck against meta strategies with AI-powered game simulation.',
    tab: 'simulator',
    cost: '7',
    power: '7000',
    type: 'CHARACTER',
    color: '#b91d22',
    colorName: 'Red',
    icon: (
      <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="relative h-screen overflow-hidden bg-op-gradient">
      {/* Map background — darkened parchment overlay */}
      <div
        className="absolute inset-0 opacity-[0.07] bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: 'url(/images/op-world-map.jpg)' }}
      />

      {/* Radial glow background */}
      <div className="bg-op-glow absolute inset-0" />

      {/* Thousand Sunny — bottom right */}
      <img
        src="/images/thousand-sunny.png"
        alt=""
        className="absolute -bottom-8 -right-12 w-[380px] max-w-[40vw] object-contain pointer-events-none select-none opacity-40 drop-shadow-[0_0_50px_rgba(209,188,0,0.15)]"
      />

      {/* Floating cards layer */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {FLOATING_CARDS.map((card, i) => (
          <img
            key={i}
            src={card.src}
            alt=""
            className={card.className}
            loading="lazy"
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-screen px-6 py-6">
        {/* Logo */}
        <img
          src="/images/logo-op-white.png"
          alt="One Piece Card Game"
          className="w-44 mb-4 animate-fade-up drop-shadow-2xl"
        />

        {/* Title */}
        <h1 className="font-[var(--font-display)] text-5xl md:text-7xl tracking-wide text-center mb-2 animate-fade-up-1">
          <span className="text-text-primary drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">GRAND </span>
          <span className="text-op-gold drop-shadow-[0_0_30px_rgba(209,188,0,0.4)]">
            DECK
          </span>
        </h1>

        {/* Subtitle */}
        <p className="font-[var(--font-heading)] text-text-secondary text-base md:text-lg max-w-lg text-center mb-6 animate-fade-up-2">
          Build decks. Explore synergies. Simulate battles.
          <br />
          <span className="text-text-muted">Your AI-powered companion for the One Piece TCG.</span>
        </p>

        {/* CTA Buttons */}
        <div className="flex gap-4 mb-10 animate-fade-up-3">
          <Button
            variant="primary"
            size="lg"
            className="animate-glow-pulse text-base px-8 py-3"
            onClick={() => onNavigate('cards')}
          >
            SET SAIL!
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="text-base px-6 py-3"
            onClick={() => onNavigate('deck')}
          >
            Build a Deck
          </Button>
        </div>

        {/* Feature Cards — TCG card style */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full animate-fade-up-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.tab}
              onClick={() => onNavigate(feature.tab)}
              className="group cursor-pointer transition-all duration-300 hover:-translate-y-3 hover:scale-[1.02]"
            >
              {/* Card frame */}
              <div
                className="relative rounded-xl overflow-hidden"
                style={{
                  background: `linear-gradient(145deg, ${feature.color}22 0%, ${feature.color}08 40%, rgba(0,0,0,0.6) 100%)`,
                  border: `2px solid ${feature.color}55`,
                  boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${feature.color}15, inset 0 1px 0 ${feature.color}30`,
                }}
              >
                {/* Cost circle — top left */}
                <div
                  className="absolute top-3 left-3 w-10 h-10 rounded-full flex items-center justify-center text-lg font-black text-white z-10"
                  style={{
                    background: `linear-gradient(135deg, ${feature.color}, ${feature.color}bb)`,
                    boxShadow: `0 2px 8px ${feature.color}60`,
                  }}
                >
                  {feature.cost}
                </div>

                {/* Power badge — top right */}
                <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm rounded-lg px-2.5 py-1 text-xs font-bold text-white z-10 border border-white/10">
                  {feature.power}
                </div>

                {/* Card art area */}
                <div
                  className="relative h-28 flex items-center justify-center overflow-hidden"
                  style={{
                    background: `radial-gradient(ellipse at center, ${feature.color}18 0%, transparent 70%)`,
                  }}
                >
                  {/* Decorative pattern */}
                  <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url(/images/op-world-map.jpg)', backgroundSize: 'cover' }} />

                  {/* Icon */}
                  <div
                    className="relative transition-transform duration-500 group-hover:scale-125 group-hover:rotate-6"
                    style={{ color: feature.color, filter: `drop-shadow(0 0 15px ${feature.color}40)` }}
                  >
                    {feature.icon}
                  </div>
                </div>

                {/* Card info — bottom section */}
                <div className="relative bg-black/60 backdrop-blur-md px-5 py-4 border-t" style={{ borderColor: `${feature.color}30` }}>
                  {/* Type banner */}
                  <div
                    className="text-[10px] font-bold tracking-widest uppercase mb-1.5"
                    style={{ color: feature.color }}
                  >
                    {feature.type}
                  </div>

                  {/* Card name */}
                  <h3 className="text-lg font-black text-white mb-2 tracking-tight">{feature.title}</h3>

                  {/* Ability text — styled like OPTCG card text */}
                  <div className="relative rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {feature.description}
                    </p>
                  </div>

                  {/* Card footer */}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-text-muted">
                      Grand Deck
                    </span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${feature.color}20`, color: feature.color }}
                    >
                      {feature.colorName}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Character illustration — bottom left */}
      <img
        src="/images/footer-chara.webp"
        alt=""
        className="absolute bottom-0 left-0 w-[420px] max-w-[45vw] object-contain pointer-events-none select-none opacity-80 drop-shadow-[0_0_40px_rgba(0,0,0,0.6)]"
      />

    </div>
  );
}
