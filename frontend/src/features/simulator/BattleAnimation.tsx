import { useState, useEffect } from 'react';

interface Props {
  progress: number; // 0-100
  completed: number;
  total: number;
  parallelGames?: number;
}

const BATTLE_SLOGANS = [
  { ja: '海賊王に俺はなる！', en: "I'm gonna be King of the Pirates!", char: 'Luffy' },
  { ja: '航海中...', en: 'Navigating the Grand Line...', char: 'Nami' },
  { ja: '仲間の夢を笑われた時だ！', en: "When a friend's dream is laughed at!", char: 'Usopp' },
  { ja: '奇跡は諦めない奴の頭上にしか降りてこない！', en: 'Miracles only come to those who never give up!', char: 'Ivankov' },
  { ja: '失ったものばかり数えるな！', en: "Don't count what you've lost!", char: 'Jinbe' },
  { ja: '人の夢は終わらねぇ！', en: "People's dreams never end!", char: 'Blackbeard' },
  { ja: '男にはどうしても戦いを避けられない時がある', en: 'There are times when a man must stand and fight!', char: 'Usopp' },
  { ja: 'この海で一番自由な奴が海賊王だ！', en: 'The freest person on the sea is the Pirate King!', char: 'Luffy' },
  { ja: '背中の傷は剣士の恥だ！', en: "A wound on the back is a swordsman's shame!", char: 'Zoro' },
  { ja: '生きたいと言え！', en: 'Say you want to live!', char: 'Luffy' },
];

function ShipImage() {
  return (
    <img
      src="/images/thousand-sunny.png"
      alt="Thousand Sunny"
      className="w-20 h-20 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] -scale-x-100"
      draggable={false}
    />
  );
}

function CrossedSwords() {
  return (
    <svg viewBox="0 0 32 32" className="w-5 h-5 animate-[sword-glow_2s_ease-in-out_infinite]" fill="none">
      {/* Left sword */}
      <line x1="6" y1="26" x2="24" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="26" x2="10" y2="24" stroke="#b45309" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="20" x2="12" y2="22" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
      {/* Right sword */}
      <line x1="26" y1="26" x2="8" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="26" y1="26" x2="22" y2="24" stroke="#b45309" strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="20" x2="20" y2="22" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export { CrossedSwords };

export default function BattleAnimation({ progress, completed, total, parallelGames }: Props) {
  const [sloganIdx, setSloganIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setSloganIdx((i) => (i + 1) % BATTLE_SLOGANS.length);
        setFading(false);
      }, 400);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const slogan = BATTLE_SLOGANS[sloganIdx];
  // Ship position: 5% to 90% based on progress
  const shipLeft = 5 + (progress * 0.85);

  return (
    <div className="relative w-full h-[140px] overflow-hidden rounded-xl bg-gradient-to-b from-[#0c4a6e] via-[#0e7490] to-[#155e75]">
      {/* Stars / sparkles in sky */}
      <div className="absolute top-2 left-[10%] w-1 h-1 bg-white/40 rounded-full animate-pulse" />
      <div className="absolute top-4 left-[30%] w-0.5 h-0.5 bg-white/30 rounded-full animate-pulse [animation-delay:0.5s]" />
      <div className="absolute top-3 left-[60%] w-1 h-1 bg-white/20 rounded-full animate-pulse [animation-delay:1s]" />
      <div className="absolute top-5 left-[80%] w-0.5 h-0.5 bg-white/40 rounded-full animate-pulse [animation-delay:1.5s]" />
      <div className="absolute top-2 left-[45%] w-0.5 h-0.5 bg-white/30 rounded-full animate-pulse [animation-delay:2s]" />

      {/* Moon */}
      <div className="absolute top-2 right-6 w-6 h-6 rounded-full bg-yellow-100/20 shadow-[0_0_12px_rgba(254,249,195,0.3)]" />

      {/* Slogan overlay */}
      <div className="absolute inset-x-0 top-2 z-20 text-center pointer-events-none">
        <div
          className={`transition-opacity duration-400 ${fading ? 'opacity-0' : 'opacity-100'}`}
        >
          <p className="text-white/90 text-xs font-bold tracking-wide drop-shadow-lg">
            {slogan.ja}
          </p>
          <p className="text-white/60 text-[10px] mt-0.5 italic drop-shadow">
            "{slogan.en}"
          </p>
          <p className="text-amber-300/70 text-[9px] mt-0.5 font-semibold">
            — {slogan.char}
          </p>
        </div>
      </div>

      {/* Ship - positioned based on progress */}
      <div
        className="absolute z-10 animate-[ship-rock_3s_ease-in-out_infinite] transition-[left] duration-1000 ease-linear"
        style={{ left: `${shipLeft}%`, bottom: '18px', transform: 'translateX(-50%)' }}
      >
        <div className="animate-[ship-bob_2s_ease-in-out_infinite]">
          <ShipImage />
        </div>
      </div>

      {/* Wake trail behind ship */}
      <div
        className="absolute z-5 bottom-[32px] h-[2px] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-all duration-1000 ease-linear"
        style={{ left: `${Math.max(0, shipLeft - 15)}%`, width: '15%' }}
      />

      {/* Wave layer 1 (back, slowest) */}
      <div className="absolute bottom-0 left-0 w-full h-[45px]">
        <div className="absolute inset-0 animate-[ocean-wave_8s_linear_infinite]">
          <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-[200%] h-full">
            <path
              d="M0 25 Q150 10 300 25 T600 25 T900 25 T1200 25 L1200 60 L0 60 Z"
              fill="rgba(6,95,124,0.6)"
            />
          </svg>
        </div>
      </div>

      {/* Wave layer 2 (middle) */}
      <div className="absolute bottom-0 left-0 w-full h-[38px]">
        <div className="absolute inset-0 animate-[ocean-wave_6s_linear_infinite_reverse]">
          <svg viewBox="0 0 1200 50" preserveAspectRatio="none" className="w-[200%] h-full">
            <path
              d="M0 20 Q100 8 200 20 T400 20 T600 20 T800 20 T1000 20 T1200 20 L1200 50 L0 50 Z"
              fill="rgba(14,116,144,0.7)"
            />
          </svg>
        </div>
      </div>

      {/* Wave layer 3 (front, fastest) */}
      <div className="absolute bottom-0 left-0 w-full h-[30px]">
        <div className="absolute inset-0 animate-[ocean-wave_4s_linear_infinite]">
          <svg viewBox="0 0 1200 40" preserveAspectRatio="none" className="w-[200%] h-full">
            <path
              d="M0 15 Q75 5 150 15 T300 15 T450 15 T600 15 T750 15 T900 15 T1050 15 T1200 15 L1200 40 L0 40 Z"
              fill="rgba(21,94,117,0.9)"
            />
          </svg>
        </div>
      </div>

      {/* Foam / spray particles */}
      <div className="absolute bottom-[26px] animate-[ocean-wave_5s_linear_infinite]">
        <div className="flex gap-12 ml-8">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="w-1 h-1 bg-white/30 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
      </div>

      {/* Status badge — bottom overlay */}
      <div className="absolute bottom-2 inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-black/40 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          <span className="text-[10px] text-white/80 font-medium">
            {completed}/{total} games
            {parallelGames && parallelGames > 1 && (
              <span className="text-white/50 ml-1">({parallelGames}x parallel)</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
