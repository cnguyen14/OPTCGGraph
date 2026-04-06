import { useState, useEffect, useCallback } from 'react';
import {
  fetchSystemStatus,
  fetchModels,
  switchModel,
  fetchStats,
  fetchCrawlStatus,
  fetchBannedCards,
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

// --- Vendor categorization for OpenRouter models ---
const VENDOR_CONFIG: Record<string, { label: string; color: string }> = {
  anthropic: { label: 'Anthropic', color: 'bg-amber-600/20 text-amber-400 border-amber-600/30' },
  openai: { label: 'OpenAI', color: 'bg-green-600/20 text-green-400 border-green-600/30' },
  google: { label: 'Google', color: 'bg-blue-600/20 text-blue-400 border-blue-600/30' },
  deepseek: { label: 'DeepSeek', color: 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30' },
  meta: { label: 'Meta', color: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30' },
  mistralai: { label: 'Mistral', color: 'bg-orange-600/20 text-orange-400 border-orange-600/30' },
  qwen: { label: 'Qwen', color: 'bg-purple-600/20 text-purple-400 border-purple-600/30' },
  other: { label: 'Other', color: 'bg-gray-600/20 text-gray-400 border-gray-600/30' },
};

function getVendorKey(modelId: string): string {
  const prefix = modelId.split('/')[0]?.toLowerCase() ?? '';
  // Normalize vendor prefixes
  if (prefix.includes('meta')) return 'meta';
  if (prefix.includes('qwen')) return 'qwen';
  if (prefix in VENDOR_CONFIG) return prefix;
  return 'other';
}

function groupModelsByVendor(models: ModelInfo[]): Record<string, ModelInfo[]> {
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of models) {
    const vendor = getVendorKey(m.id);
    if (!groups[vendor]) groups[vendor] = [];
    groups[vendor].push(m);
  }
  // Sort vendors: put ones with more models first, "other" last
  const sorted: Record<string, ModelInfo[]> = {};
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return (groups[b]?.length ?? 0) - (groups[a]?.length ?? 0);
  });
  for (const k of keys) sorted[k] = groups[k];
  return sorted;
}

// --- Tier badge ---
function TierBadge({ tier }: { tier: number }) {
  const colors =
    tier === 1
      ? 'bg-green-900/40 text-green-400 border-green-700/30'
      : tier === 2
        ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700/30'
        : 'bg-gray-900/40 text-gray-500 border-gray-700/30';
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-medium rounded border ${colors}`}>
      T{tier}
    </span>
  );
}

// --- AI Model Selector ---
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
    { key: 'anthropic', label: 'Anthropic (Direct)', backendKey: 'claude' },
    { key: 'openrouter', label: 'OpenRouter', backendKey: 'openrouter' },
  ];

  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(() => {
    if (models?.current.provider === 'openrouter') return 'openrouter';
    return 'anthropic';
  });
  const [providerModels, setProviderModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);

  const info = AI_PROVIDERS.find((p) => p.key === selectedProvider)!;
  const hasKey = sysStatus?.api_keys[selectedProvider] ?? false;

  useEffect(() => {
    setProviderModels([]);
    setSelectedVendor(null);
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

  const vendorGroups = selectedProvider === 'openrouter' ? groupModelsByVendor(providerModels) : null;
  const vendorKeys = vendorGroups ? Object.keys(vendorGroups) : [];
  const displayModels =
    selectedProvider === 'openrouter' && selectedVendor && vendorGroups
      ? vendorGroups[selectedVendor] ?? []
      : providerModels;

  // Auto-select the vendor of the active model
  useEffect(() => {
    if (selectedProvider === 'openrouter' && models?.current.provider === 'openrouter' && !selectedVendor && providerModels.length > 0) {
      const activeVendor = getVendorKey(models.current.model);
      setSelectedVendor(activeVendor);
    }
  }, [selectedProvider, models, providerModels, selectedVendor]);

  return (
    <div className="space-y-4">
      {/* Active model display */}
      {models && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-muted">Active:</span>
          <span className="px-2.5 py-1 rounded-lg bg-op-ocean/15 border border-op-ocean/30 text-op-ocean font-medium text-xs">
            {models.current.model}
          </span>
          <span className="text-[10px] text-text-muted">via {models.current.provider}</span>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex gap-2">
        {AI_PROVIDERS.map((p) => {
          const active = selectedProvider === p.key;
          const providerHasKey = sysStatus?.api_keys[p.key] ?? false;
          return (
            <button
              key={p.key}
              onClick={() => setSelectedProvider(p.key)}
              className={`px-4 py-2 text-xs font-medium rounded-lg border transition-all ${
                active
                  ? 'bg-op-ocean/20 border-op-ocean/50 text-op-ocean shadow-sm'
                  : 'bg-surface-1 border-glass-border text-text-secondary hover:bg-surface-2 hover:text-text-primary'
              }`}
            >
              {p.label}
              {!providerHasKey && (
                <span className="ml-1.5 text-[9px] text-red-400">No Key</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {!hasKey ? (
        <div className="px-4 py-6 text-center border border-dashed border-glass-border rounded-xl">
          <p className="text-sm text-text-muted">
            Configure an API key for <span className="text-text-secondary font-medium">{info.label}</span> in
            the API Keys section above.
          </p>
        </div>
      ) : loadingModels ? (
        <div className="flex items-center gap-2 py-4 text-xs text-text-muted">
          <Spinner size="sm" />
          Loading models from {info.label}...
        </div>
      ) : providerModels.length > 0 ? (
        <div className="space-y-3">
          {/* Vendor category pills (OpenRouter only) */}
          {selectedProvider === 'openrouter' && vendorKeys.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {vendorKeys.map((vendor) => {
                const cfg = VENDOR_CONFIG[vendor] ?? VENDOR_CONFIG.other;
                const count = vendorGroups![vendor]?.length ?? 0;
                const active = selectedVendor === vendor;
                return (
                  <button
                    key={vendor}
                    onClick={() => setSelectedVendor(active ? null : vendor)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full border transition-all ${
                      active
                        ? `${cfg.color} ring-1 ring-current/20`
                        : 'bg-surface-1 border-glass-border text-text-muted hover:text-text-secondary hover:bg-surface-2'
                    }`}
                  >
                    {cfg.label}
                    <span className={`text-[9px] ${active ? 'opacity-70' : 'text-text-muted'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Model grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
            {displayModels.map((m) => {
              const isActive =
                models?.current.provider === info.backendKey && models?.current.model === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onModelSwitch(info.backendKey, m.id)}
                  title={m.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                    isActive
                      ? 'bg-op-ocean/15 border-op-ocean/40 ring-1 ring-op-ocean/20'
                      : 'bg-surface-1 border-glass-border hover:bg-surface-2 hover:border-text-muted/30'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-xs font-medium truncate ${isActive ? 'text-op-ocean' : 'text-text-primary'}`}
                    >
                      {m.name}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">{m.id}</div>
                  </div>
                  <TierBadge tier={m.tier} />
                </button>
              );
            })}
          </div>

          {/* Footer info */}
          <div className="flex items-center justify-between text-[10px] text-text-muted pt-1">
            <span>
              {selectedVendor
                ? `${displayModels.length} models from ${VENDOR_CONFIG[selectedVendor]?.label ?? selectedVendor}`
                : `${providerModels.length} models available`}
            </span>
            {selectedProvider === 'openrouter' && selectedVendor && (
              <button
                onClick={() => setSelectedVendor(null)}
                className="text-op-ocean hover:underline"
              >
                Show all
              </button>
            )}
          </div>
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
    // Check if a rebuild is already running (e.g. after page refresh)
    (async () => {
      try {
        const { fetchRebuildStatus } = await import('../../lib/api');
        const rs = await fetchRebuildStatus();
        if (rs.status && rs.status !== 'idle' && rs.status !== 'complete') {
          setRebuildStatus(rs.status);
          setPolling(true);
        }
      } catch { /* ignore */ }
    })();
  }, [loadAll]);

  // Auto-refresh crawl status + rebuild status while polling
  const [banPanelOpen, setBanPanelOpen] = useState(true);
  const [polling, setPolling] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState('idle');
  const [stepStatuses, setStepStatuses] = useState<Record<string, string>>({ clean: 'idle', bandai: 'idle', prices: 'idle', banned: 'idle', tournaments: 'idle', index: 'idle' });
  const [rebuildStuckCount, setRebuildStuckCount] = useState(0);
  const [lastRebuildStep, setLastRebuildStep] = useState('');
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      const cs = await fetchCrawlStatus();
      setCrawlStatus(cs);
      try {
        const { fetchRebuildStatus } = await import('../../lib/api');
        const rs = await fetchRebuildStatus();
        const status = rs.status || 'idle';
        setRebuildStatus(status);
        if (rs.steps) setStepStatuses(rs.steps);

        // Check if all steps are done or any individual step completed
        const allDone = rs.steps && Object.values(rs.steps).every((s: string) => s === 'done' || s === 'idle');
        const anyRunning = rs.steps && Object.values(rs.steps).some((s: string) => s !== 'done' && s !== 'idle' && !s.startsWith('error'));

        if (status === 'complete' || (allDone && !anyRunning && status === 'idle')) {
          if (rs.steps && Object.values(rs.steps).some((s: string) => s === 'done')) {
            setPolling(false);
            setRebuildStuckCount(0);
            showAction('Step complete!');
            loadAll();
          }
        } else if (status.startsWith('error')) {
          setPolling(false);
          showAction(`Rebuild failed: ${status}`);
          setRebuildStuckCount(0);
        } else if (status !== 'idle') {
          // Stuck detection: if same step for 90s (30 polls × 3s)
          if (status === lastRebuildStep) {
            setRebuildStuckCount(prev => prev + 1);
          } else {
            setRebuildStuckCount(0);
            setLastRebuildStep(status);
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    const timeout = setTimeout(() => setPolling(false), 600000);
    return () => {
      clearInterval(id);
      clearTimeout(timeout);
    };
  }, [polling, lastRebuildStep]);

  const handleStopRebuild = async () => {
    const { stopRebuild } = await import('../../lib/api');
    await stopRebuild();
    setRebuildStatus('idle');
    setPolling(false);
    setRebuildStuckCount(0);
    showAction('Rebuild stopped');
  };

  const showAction = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 4000);
  };

  const refreshStatus = async () => {
    const sys = await fetchSystemStatus();
    setSysStatus(sys);
  };

  const handleStep = async (step: string) => {
    const { triggerStep } = await import('../../lib/api');
    await triggerStep(step as any);
    showAction(`${step} started...`);
    setPolling(true);
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
          {/* Pipeline steps */}
          {([
            { key: 'clean', label: '1. Clean Up Old Data', variant: 'danger' as const },
            { key: 'bandai', label: '2. Load Cards (Bandai)', variant: 'secondary' as const },
            { key: 'prices', label: '3. Update Prices', variant: 'secondary' as const },
            { key: 'banned', label: '4. Update Ban List', variant: 'secondary' as const },
            { key: 'tournaments', label: '5. Load Tournaments', variant: 'secondary' as const },
            { key: 'index', label: '6. Build Index', variant: 'secondary' as const },
          ]).map(({ key, label, variant }) => {
            const st = stepStatuses[key] || 'idle';
            const isRunning = st !== 'idle' && st !== 'done' && !st.startsWith('error');
            const isDone = st === 'done';
            const isError = st.startsWith('error');
            return (
              <div key={key}>
                <Button
                  onClick={() => handleStep(key)}
                  variant={isError ? 'danger' : variant}
                  size="sm"
                  className="w-full"
                  disabled={isRunning}
                >
                  {isRunning ? `${label}...` : isDone ? `${label} ✓` : label}
                </Button>
                {isRunning && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-op-ocean animate-pulse" />
                    <span className="text-[9px] text-op-ocean font-mono">{st.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {isError && (
                  <p className="text-[9px] text-red-400 mt-0.5 break-all">{st.slice(0, 80)}</p>
                )}
              </div>
            );
          })}
          {Object.values(stepStatuses).some(s => s !== 'idle' && s !== 'done') && (
            <Button onClick={handleStopRebuild} variant="secondary" size="sm" className="w-full mt-1">
              Stop / Reset
            </Button>
          )}
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
                      { key: 'bandai' as const, label: 'Bandai Official (Cards + Images)', src: crawlStatus.bandai ?? { last_run: null, count: 0 } },
                      { key: 'optcgapi' as const, label: 'OptcgAPI (Prices)', src: crawlStatus.optcgapi },
                      { key: 'limitlesstcg' as const, label: 'LimitlessTCG (Tournaments)', src: crawlStatus.limitlesstcg },
                      { key: 'banned' as const, label: 'Ban List', src: crawlStatus.banned },
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

      {/* Right Panel — Banned Cards (collapsible) */}
      <div
        className={`glass shrink-0 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
          banPanelOpen ? 'w-[380px]' : 'w-12'
        }`}
      >
        {banPanelOpen ? (
          <>
            <div className="shrink-0 px-4 py-2.5 border-b border-glass-border/50 flex items-center justify-between">
              <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                Banned Cards <span className="text-text-muted font-normal">({bannedCards.length})</span>
              </p>
              <div className="flex items-center gap-2">
                {crawlStatus?.banned.last_run && (
                  <span className="text-[10px] text-text-muted">
                    {timeAgo(crawlStatus.banned.last_run)}
                  </span>
                )}
                <button
                  onClick={() => setBanPanelOpen(false)}
                  className="text-text-muted hover:text-text-primary transition-colors p-0.5"
                  title="Collapse"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {bannedCards.length === 0 ? (
                <div className="flex-1 flex items-center justify-center h-full text-text-muted">
                  <div className="text-center">
                    <p className="text-sm">No banned cards found</p>
                    <p className="text-xs mt-1 mb-3">Fetch the ban list from Bandai</p>
                    <Button onClick={handleRebuild} variant="danger" size="sm">
                      Full Rebuild
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
          </>
        ) : (
          <button
            onClick={() => setBanPanelOpen(true)}
            className="flex flex-col items-center justify-center h-full gap-2 hover:bg-surface-1 transition-colors cursor-pointer"
            title="Show Banned Cards"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span className="text-[10px] text-text-muted font-medium [writing-mode:vertical-lr] tracking-wider">
              BANNED ({bannedCards.length})
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
