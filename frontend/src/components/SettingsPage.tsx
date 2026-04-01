import { useState, useEffect, useCallback } from 'react';
import {
  fetchSystemStatus,
  fetchModels,
  switchModel,
  fetchStats,
  fetchCrawlStatus,
  fetchBannedCards,
  triggerCrawl,
  triggerPriceUpdate,
  triggerBanCrawl,
  saveApiKey,
  removeApiKey,
  testApiKey,
  checkApiBalance,
  fetchProviderModels,
} from '../lib/api';
import type {
  SystemStatus,
  CrawlStatus,
  BannedCard,
  ModelsResponse,
  ModelInfo,
} from '../types';

// --- Helpers ---
function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  );
}

// --- Section wrapper ---
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800/30 transition-colors"
      >
        {title}
        <span className="text-gray-500 text-xs">{open ? 'Collapse' : 'Expand'}</span>
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

// --- Single API Key Row ---
type KeyProvider = 'anthropic' | 'openrouter' | 'apitcg';

const KEY_PROVIDERS: {
  key: KeyProvider;
  label: string;
  description: string;
}[] = [
  { key: 'anthropic', label: 'Anthropic', description: 'Claude AI models (direct API)' },
  { key: 'openrouter', label: 'OpenRouter', description: '300+ models via unified gateway' },
  { key: 'apitcg', label: 'ApiTCG', description: 'Card data source for crawling' },
];

function ApiKeyRow({
  provider,
  hasEnvKey,
  hasRuntimeKey,
  onAction,
  onStatusChange,
}: {
  provider: (typeof KEY_PROVIDERS)[number];
  hasEnvKey: boolean;
  hasRuntimeKey: boolean;
  onAction: (msg: string) => void;
  onStatusChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const hasAnyKey = hasEnvKey || hasRuntimeKey;

  const handleTest = async () => {
    if (!keyInput.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testApiKey(provider.key, keyInput.trim());
      setTestResult(result);
    } catch {
      setTestResult({ status: 'error', message: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    try {
      await saveApiKey(provider.key, keyInput.trim());
      setKeyInput('');
      setTestResult(null);
      setExpanded(false);
      onAction(`API key saved for ${provider.label}`);
      onStatusChange();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    await removeApiKey(provider.key);
    setTestResult(null);
    onAction(`Runtime key removed for ${provider.label}`);
    onStatusChange();
  };

  return (
    <div className="bg-gray-800/30 rounded-lg border border-gray-700/30 overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusDot ok={hasAnyKey} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white font-medium">{provider.label}</div>
          <div className="text-[11px] text-gray-500">{provider.description}</div>
        </div>
        <div className="flex items-center gap-2">
          {hasRuntimeKey && (
            <span className="px-2 py-0.5 text-[10px] bg-blue-900/30 text-blue-400 rounded border border-blue-700/30">
              BYOK
            </span>
          )}
          {hasEnvKey && !hasRuntimeKey && (
            <span className="px-2 py-0.5 text-[10px] bg-green-900/30 text-green-400 rounded border border-green-700/30">
              ENV
            </span>
          )}
          {!hasAnyKey && (
            <span className="px-2 py-0.5 text-[10px] bg-red-900/30 text-red-400 rounded border border-red-700/30">
              MISSING
            </span>
          )}
          <span className="text-gray-600 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {/* Expanded: key input */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-700/30 space-y-3">
          {hasRuntimeKey && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-400">Runtime key is active (overrides .env)</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="text-red-400 hover:text-red-300 underline"
              >
                Remove runtime key
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setTestResult(null);
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder={hasAnyKey ? 'Enter new key to override...' : 'Paste API key here...'}
                className="w-full px-3 py-2 text-sm bg-gray-900/50 border border-gray-700/50 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKey(!showKey);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTest();
              }}
              disabled={!keyInput.trim() || testing}
              className="px-4 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
          </div>

          {testResult && (
            <div
              className={`px-3 py-1.5 text-xs rounded-lg border ${
                testResult.status === 'ok'
                  ? 'bg-green-950/30 border-green-700/40 text-green-400'
                  : 'bg-red-950/30 border-red-700/40 text-red-400'
              }`}
            >
              {testResult.status === 'ok' ? '\u2713 ' : '\u2717 '}
              {testResult.message}
            </div>
          )}

          {testResult?.status === 'ok' && keyInput.trim() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg border border-blue-500/40 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save Key'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- AI Model Selector (simplified — keys managed in API Keys section) ---
function AIModelSelector({
  models,
  sysStatus,
  onModelSwitch,
  onAction,
}: {
  models: ModelsResponse | null;
  sysStatus: SystemStatus | null;
  onModelSwitch: (provider: string, model: string) => Promise<void>;
  onAction: (msg: string) => void;
}) {
  type AIProvider = 'anthropic' | 'openrouter';
  const AI_PROVIDERS: { key: AIProvider; label: string; backendKey: string }[] = [
    { key: 'anthropic', label: 'Anthropic (Claude)', backendKey: 'claude' },
    { key: 'openrouter', label: 'OpenRouter', backendKey: 'openrouter' },
  ];

  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(() => {
    if (models?.current.provider === 'openrouter') return 'openrouter';
    return 'anthropic';
  });
  const [providerModels, setProviderModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const info = AI_PROVIDERS.find((p) => p.key === selectedProvider)!;
  const hasKey = sysStatus?.api_keys[selectedProvider] ?? false;

  useEffect(() => {
    setProviderModels([]);
    if (hasKey) {
      loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, hasKey]);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const result = await fetchProviderModels(info.backendKey);
      if (result.status === 'ok') {
        setProviderModels(result.models);
      } else {
        onAction(`Failed to load models: ${result.message}`);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="space-y-4">
      {models && (
        <div className="text-sm text-gray-400">
          Active:{' '}
          <span className="text-white font-medium">
            {models.current.provider} / {models.current.model}
          </span>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex gap-2">
        {AI_PROVIDERS.map((p) => (
          <button
            key={p.key}
            onClick={() => setSelectedProvider(p.key)}
            className={`px-4 py-2 text-xs rounded-lg border transition-colors ${
              selectedProvider === p.key
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Model list */}
      {!hasKey ? (
        <p className="text-xs text-gray-500">
          Configure an API key for {info.label} in the API Keys section above to see available models.
        </p>
      ) : loadingModels ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
          Loading models...
        </div>
      ) : providerModels.length > 0 ? (
        <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
          {providerModels.map((m) => {
            const isActive =
              models?.current.provider === info.backendKey && models?.current.model === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onModelSwitch(info.backendKey, m.id)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                    : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600'
                }`}
                title={m.id}
              >
                {m.name}
                <span className="ml-1.5 text-[10px] text-gray-500">T{m.tier}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <button
          onClick={loadModels}
          className="px-4 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg border border-gray-700/50 transition-colors"
        >
          Load Models
        </button>
      )}
    </div>
  );
}

// --- Main component ---
export default function SettingsPage() {
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [dbStats, setDbStats] = useState<Record<string, number> | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus | null>(null);
  const [bannedCards, setBannedCards] = useState<BannedCard[]>([]);
  const [balance, setBalance] = useState<{ has_balance: boolean; status: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sys, mdl, stats, crawl, banned, bal] = await Promise.all([
        fetchSystemStatus(),
        fetchModels(),
        fetchStats(),
        fetchCrawlStatus(),
        fetchBannedCards(),
        checkApiBalance().catch(() => ({ has_balance: false, status: 'error', message: 'Failed to check' })),
      ]);
      setSysStatus(sys);
      setModels(mdl);
      setDbStats(stats);
      setCrawlStatus(crawl);
      setBannedCards(banned);
      setBalance(bal);
    } catch (err) {
      console.error('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Auto-refresh crawl status while polling
  const [polling, setPolling] = useState(false);
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      const cs = await fetchCrawlStatus();
      setCrawlStatus(cs);
    }, 5000);
    const timeout = setTimeout(() => setPolling(false), 120000);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [polling]);

  const showAction = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 4000);
  };

  const refreshStatus = async () => {
    const sys = await fetchSystemStatus();
    setSysStatus(sys);
  };

  const handleCrawl = async () => {
    await triggerCrawl();
    showAction('Card crawl started...');
    setPolling(true);
  };

  const handlePriceUpdate = async () => {
    await triggerPriceUpdate();
    showAction('Price update started...');
    setPolling(true);
  };

  const handleBanCrawl = async () => {
    await triggerBanCrawl();
    showAction('Ban list update started...');
    setPolling(true);
    setTimeout(async () => {
      const banned = await fetchBannedCards();
      setBannedCards(banned);
    }, 5000);
  };

  const handleModelSwitch = async (provider: string, model: string) => {
    await switchModel(provider, model);
    const [mdl, sys] = await Promise.all([fetchModels(), fetchSystemStatus()]);
    setModels(mdl);
    setSysStatus(sys);
    showAction(`Switched to ${model}`);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-sm text-gray-400">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Settings</h2>
            <p className="text-sm text-gray-400 mt-1">
              System status, API keys, AI models, data management, and ban list.
            </p>
          </div>
          <button
            onClick={loadAll}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            Refresh All
          </button>
        </div>

        {/* Action toast */}
        {actionMsg && (
          <div className="rounded-lg bg-blue-950/40 border border-blue-700/40 px-4 py-2 text-xs text-blue-300">
            {actionMsg}
          </div>
        )}

        {/* Section 1: System Status (infrastructure only) */}
        <Section title="System Status">
          {sysStatus && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={sysStatus.neo4j} />
                <span className="text-gray-300">Neo4j</span>
                <span className="text-gray-500 text-xs ml-auto font-mono">
                  {sysStatus.neo4j_uri}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={sysStatus.redis} />
                <span className="text-gray-300">Redis</span>
                <span className="text-gray-500 text-xs ml-auto font-mono">
                  {sysStatus.redis_url}
                </span>
              </div>
            </div>
          )}
        </Section>

        {/* Claude API Balance */}
        <Section title="Claude API Balance">
          {balance ? (
            <div className={`flex items-center gap-3 p-3 rounded-lg ${
              balance.has_balance
                ? 'bg-green-900/20 border border-green-700/30'
                : 'bg-red-900/20 border border-red-700/30'
            }`}>
              <div className={`w-3 h-3 rounded-full ${balance.has_balance ? 'bg-green-500' : 'bg-red-500'}`} />
              <div>
                <p className={`text-sm font-medium ${balance.has_balance ? 'text-green-400' : 'text-red-400'}`}>
                  {balance.has_balance ? 'Balance Available' : 'Insufficient Balance'}
                </p>
                <p className="text-xs text-gray-400">{balance.message}</p>
              </div>
              {!balance.has_balance && (
                <a
                  href="https://console.anthropic.com/settings/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  Add Credits
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Checking balance...</p>
          )}
        </Section>

        {/* Section 2: API Keys (all providers) */}
        <Section title="API Keys">
          <p className="text-xs text-gray-500 -mt-1 mb-1">
            Manage API keys for all services. Keys set here override .env values at runtime.
          </p>
          <div className="space-y-2">
            {KEY_PROVIDERS.map((provider) => (
              <ApiKeyRow
                key={provider.key}
                provider={provider}
                hasEnvKey={sysStatus?.api_keys[provider.key] ?? false}
                hasRuntimeKey={sysStatus?.runtime_keys[provider.key] ?? false}
                onAction={showAction}
                onStatusChange={refreshStatus}
              />
            ))}
          </div>
        </Section>

        {/* Section 3: AI Model Configuration */}
        <Section title="AI Model Configuration">
          <AIModelSelector
            models={models}
            sysStatus={sysStatus}
            onModelSwitch={handleModelSwitch}
            onAction={showAction}
          />
        </Section>

        {/* Section 4: Data Dashboard */}
        <Section title="Data Dashboard">
          <div className="space-y-4">
            {dbStats && (
              <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Knowledge Graph
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Cards', value: dbStats.cards },
                    { label: 'Colors', value: dbStats.colors },
                    { label: 'Families', value: dbStats.families },
                    { label: 'Sets', value: dbStats.sets },
                    { label: 'Keywords', value: dbStats.keywords },
                    { label: 'Synergy Edges', value: dbStats.synergy_edges },
                    { label: 'Mech. Synergy', value: dbStats.mech_synergy_edges },
                    { label: 'Curves Into', value: dbStats.curves_into_edges },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="bg-gray-800/40 rounded-lg px-3 py-2 border border-gray-700/30"
                    >
                      <div className="text-lg font-bold text-white">
                        {stat.value != null ? stat.value.toLocaleString() : '--'}
                      </div>
                      <div className="text-[10px] text-gray-500">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {crawlStatus && (
              <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Data Sources
                </h4>
                <div className="space-y-2">
                  {[
                    { key: 'apitcg' as const, label: 'ApiTCG (Cards)', src: crawlStatus.apitcg },
                    {
                      key: 'optcgapi' as const,
                      label: 'OptcgAPI (Prices)',
                      src: crawlStatus.optcgapi,
                    },
                    {
                      key: 'limitlesstcg' as const,
                      label: 'LimitlessTCG (Meta)',
                      src: crawlStatus.limitlesstcg,
                    },
                    { key: 'banned' as const, label: 'Bandai (Ban List)', src: crawlStatus.banned },
                  ].map(({ key, label, src }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between text-sm bg-gray-800/30 rounded-lg px-3 py-2"
                    >
                      <span className="text-gray-300">{label}</span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500">
                          {src.count > 0 ? `${src.count} items` : '--'}
                        </span>
                        <span className={src.last_run ? 'text-gray-400' : 'text-gray-600'}>
                          {timeAgo(src.last_run)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={handleCrawl}
                className="px-4 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700/50 transition-colors"
              >
                Re-crawl Cards
              </button>
              <button
                onClick={handlePriceUpdate}
                className="px-4 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-gray-700/50 transition-colors"
              >
                Update Prices
              </button>
              <button
                onClick={handleBanCrawl}
                className="px-4 py-2 text-xs bg-red-950/40 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded-lg border border-red-800/30 transition-colors"
              >
                Update Ban List
              </button>
            </div>
          </div>
        </Section>

        {/* Section 5: Banned Cards */}
        <Section
          title={`Banned Cards (${bannedCards.length})`}
          defaultOpen={bannedCards.length > 0}
        >
          {bannedCards.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500 mb-2">No banned cards found in database.</p>
              <button
                onClick={handleBanCrawl}
                className="px-4 py-2 text-xs bg-red-950/40 hover:bg-red-900/50 text-red-400 rounded-lg border border-red-800/30 transition-colors"
              >
                Fetch Ban List from Bandai
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {crawlStatus?.banned.last_run && (
                <p className="text-xs text-gray-500">
                  Last updated:{' '}
                  {new Date(crawlStatus.banned.last_run).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              )}
              <div className="divide-y divide-gray-800/50">
                {bannedCards.map((card) => (
                  <div key={card.id} className="flex items-center gap-3 py-2">
                    {card.image_small ? (
                      <img
                        src={card.image_small}
                        alt={card.name}
                        className="w-10 h-14 object-cover rounded border border-gray-700/50"
                      />
                    ) : (
                      <div className="w-10 h-14 bg-gray-800 rounded border border-gray-700/50 flex items-center justify-center">
                        <span className="text-[8px] text-gray-600">{card.id}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium">{card.name || card.id}</div>
                      <div className="text-xs text-gray-500">{card.id}</div>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-red-900/40 text-red-400 rounded uppercase">
                      Banned
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
