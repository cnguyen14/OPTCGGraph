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
} from '../../lib/api';
import type {
  SystemStatus,
  CrawlStatus,
  BannedCard,
  ModelsResponse,
  ModelInfo,
} from '../../types';
import { Button, Badge, Spinner } from '../../components/ui';

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
    <div className="border border-glass-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-text-primary hover:bg-surface-1 transition-colors"
      >
        {title}
        <span className="text-text-muted text-xs">{open ? 'Collapse' : 'Expand'}</span>
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
    <div className="border border-glass-border rounded-lg overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-1 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusDot ok={hasAnyKey} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">{provider.label}</div>
          <div className="text-[11px] text-text-muted">{provider.description}</div>
        </div>
        <div className="flex items-center gap-2">
          {hasRuntimeKey && (
            <Badge variant="blue">BYOK</Badge>
          )}
          {hasEnvKey && !hasRuntimeKey && (
            <Badge variant="green">ENV</Badge>
          )}
          {!hasAnyKey && (
            <Badge variant="red">MISSING</Badge>
          )}
          <span className="text-text-muted text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {/* Expanded: key input */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-glass-border space-y-3">
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
                className="w-full px-3 py-2 text-sm bg-surface-1 border border-glass-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-op-ocean font-mono"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKey(!showKey);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text-secondary"
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
              className="px-4 py-2 text-xs bg-surface-2 hover:bg-surface-3 text-text-primary rounded-lg border border-glass-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
          </div>

          {testResult && (
            <div
              className={`px-3 py-1.5 text-xs rounded-lg border glass-subtle ${
                testResult.status === 'ok'
                  ? 'border-green-700/40 text-green-400'
                  : 'border-red-700/40 text-red-400'
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
              className="px-4 py-1.5 text-xs bg-op-ocean/20 hover:bg-op-ocean/30 text-op-ocean rounded-lg border border-op-ocean/40 transition-colors disabled:opacity-40"
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
        <div className="text-sm text-text-secondary">
          Active:{' '}
          <span className="text-text-primary font-medium">
            {models.current.provider} / {models.current.model}
          </span>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex gap-2">
        {AI_PROVIDERS.map((p) => (
          <Button
            key={p.key}
            onClick={() => setSelectedProvider(p.key)}
            variant={selectedProvider === p.key ? 'primary' : 'secondary'}
            size="sm"
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Model list */}
      {!hasKey ? (
        <p className="text-xs text-text-muted">
          Configure an API key for {info.label} in the API Keys section above to see available models.
        </p>
      ) : loadingModels ? (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Spinner size="sm" />
          Loading models...
        </div>
      ) : providerModels.length > 0 ? (
        <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
          {providerModels.map((m) => {
            const isActive =
              models?.current.provider === info.backendKey && models?.current.model === m.id;
            return (
              <Button
                key={m.id}
                onClick={() => onModelSwitch(info.backendKey, m.id)}
                variant={isActive ? 'primary' : 'secondary'}
                size="sm"
                title={m.id}
              >
                {m.name}
                <span className="ml-1.5 text-[10px] text-text-muted">T{m.tier}</span>
              </Button>
            );
          })}
        </div>
      ) : (
        <Button onClick={loadModels} variant="secondary" size="sm">
          Load Models
        </Button>
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
      <div className="h-full flex items-center justify-center gap-2">
        <Spinner size="md" />
        <span className="text-sm text-text-secondary">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex gap-3 p-3 overflow-hidden">
      {/* Left Sidebar — Status & Quick Actions */}
      <div className="glass w-56 shrink-0 overflow-y-auto p-4 space-y-4 flex flex-col">
        {/* System Status */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">System</label>
          {sysStatus && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <StatusDot ok={sysStatus.neo4j} />
                <span className="text-text-secondary">Neo4j</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <StatusDot ok={sysStatus.redis} />
                <span className="text-text-secondary">Redis</span>
              </div>
            </div>
          )}
        </div>

        {/* API Balance */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5 block">API Balance</label>
          {balance ? (
            <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
              balance.has_balance
                ? 'bg-green-900/20 border border-green-700/30'
                : 'bg-red-900/20 border border-red-700/30'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${balance.has_balance ? 'bg-green-500' : 'bg-red-500'}`} />
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${balance.has_balance ? 'text-green-400' : 'text-red-400'}`}>
                  {balance.has_balance ? 'Available' : 'Low'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-text-muted">Checking...</p>
          )}
          {balance && !balance.has_balance && (
            <a
              href="https://console.anthropic.com/settings/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300 underline mt-1 block"
            >
              Add Credits
            </a>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2 mt-auto">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted block">Actions</label>
          <Button onClick={loadAll} variant="secondary" size="sm" className="w-full">
            Refresh All
          </Button>
          <Button onClick={handleCrawl} variant="secondary" size="sm" className="w-full">
            Re-crawl Cards
          </Button>
          <Button onClick={handlePriceUpdate} variant="secondary" size="sm" className="w-full">
            Update Prices
          </Button>
          <Button onClick={handleBanCrawl} variant="danger" size="sm" className="w-full">
            Update Ban List
          </Button>
          {actionMsg && (
            <p className="text-[10px] text-op-ocean mt-1">{actionMsg}</p>
          )}
        </div>
      </div>

      {/* Center — Main Settings */}
      <div className="flex-1 glass overflow-hidden min-w-0 flex flex-col">
        <div className="shrink-0 px-4 py-2.5 border-b border-glass-border/50">
          <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">Settings</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* API Keys */}
          <Section title="API Keys">
            <p className="text-xs text-text-muted -mt-1 mb-1">
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

          {/* AI Model Configuration */}
          <Section title="AI Model Configuration">
            <AIModelSelector
              models={models}
              sysStatus={sysStatus}
              onModelSwitch={handleModelSwitch}
              onAction={showAction}
            />
          </Section>

          {/* Data Dashboard */}
          <Section title="Data Dashboard">
            <div className="space-y-4">
              {dbStats && (
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">
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
                        className="border border-glass-border rounded-lg px-3 py-2"
                      >
                        <div className="text-lg font-bold text-text-primary">
                          {stat.value != null ? stat.value.toLocaleString() : '--'}
                        </div>
                        <div className="text-[10px] text-text-muted">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {crawlStatus && (
                <div>
                  <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">
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
                        className="flex items-center justify-between text-sm border border-glass-border rounded-lg px-3 py-2"
                      >
                        <span className="text-text-secondary">{label}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-text-muted">
                            {src.count > 0 ? `${src.count} items` : '--'}
                          </span>
                          <span className={src.last_run ? 'text-text-secondary' : 'text-text-muted'}>
                            {timeAgo(src.last_run)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Right Panel — Banned Cards */}
      <div className="glass w-[380px] shrink-0 flex flex-col overflow-hidden">
        <div className="shrink-0 px-4 py-2.5 border-b border-glass-border/50 flex items-center justify-between">
          <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
            Banned Cards <span className="text-text-muted font-normal">({bannedCards.length})</span>
          </p>
          {crawlStatus?.banned.last_run && (
            <span className="text-[10px] text-text-muted">
              {timeAgo(crawlStatus.banned.last_run)}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {bannedCards.length === 0 ? (
            <div className="flex-1 flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <p className="text-sm">No banned cards found</p>
                <p className="text-xs mt-1 mb-3">Fetch the ban list from Bandai</p>
                <Button onClick={handleBanCrawl} variant="danger" size="sm">
                  Fetch Ban List
                </Button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-glass-border/50">
              {bannedCards.map((card) => (
                <div key={card.id} className="flex items-center gap-3 px-4 py-2.5">
                  {card.image_small ? (
                    <img
                      src={card.image_small}
                      alt={card.name}
                      className="w-10 h-14 object-cover rounded border border-glass-border shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-14 bg-surface-2 rounded border border-glass-border flex items-center justify-center shrink-0">
                      <span className="text-[8px] text-text-muted">{card.id}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary font-medium truncate">{card.name || card.id}</div>
                    <div className="text-[10px] text-text-muted">{card.id}</div>
                  </div>
                  <Badge variant="red">Banned</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
