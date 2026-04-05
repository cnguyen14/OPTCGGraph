import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { GlassCard, Spinner } from '../../components/ui';
import { fetchSimulationAnalytics } from '../../lib/api';
import type { SimAnalyticsEntry } from '../../types';

const MODEL_COLORS = ['#0ea5e9', '#f43f5e', '#a855f7', '#22c55e', '#f59e0b', '#6366f1'];

function modelLabel(entry: SimAnalyticsEntry): string {
  return entry.model ?? `${entry.mode}/${entry.p1_level}`;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Section 1: Model Overview Table
// ---------------------------------------------------------------------------

function ModelOverviewTable({ sims }: { sims: SimAnalyticsEntry[] }) {
  // Find best (max) for each numeric column
  const best = {
    winRate: Math.max(...sims.map((s) => s.stats.p1_win_rate)),
    avgTurns: Math.min(...sims.map((s) => s.stats.avg_turns)), // lower is "better"
    p1Dmg: Math.max(...sims.map((s) => s.stats.avg_p1_damage)),
    p1Life: Math.max(...sims.map((s) => s.stats.avg_p1_life_remaining)),
    decPerGame: Math.max(...sims.map((s) => s.stats.avg_decisions_per_game)),
  };

  const highlight = (val: number, bestVal: number) =>
    val === bestVal ? 'text-emerald-400 font-semibold' : '';

  return (
    <GlassCard variant="subtle" className="p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Model Overview
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-text-muted text-xs uppercase tracking-wider border-b border-glass-border/40">
            <th className="text-left py-2 pr-4">Model</th>
            <th className="text-left py-2 pr-4">Matchup</th>
            <th className="text-right py-2 pr-4">Games</th>
            <th className="text-right py-2 pr-4">P1 Win%</th>
            <th className="text-right py-2 pr-4">Avg Turns</th>
            <th className="text-right py-2 pr-4">P1 Dmg</th>
            <th className="text-right py-2 pr-4">P1 Life</th>
            <th className="text-right py-2">Dec/Game</th>
          </tr>
        </thead>
        <tbody>
          {sims.map((s, i) => (
            <tr key={s.sim_id} className="border-b border-glass-border/20 hover:bg-white/[0.02]">
              <td className="py-2 pr-4 font-medium" style={{ color: MODEL_COLORS[i % MODEL_COLORS.length] }}>
                {modelLabel(s)}
              </td>
              <td className="py-2 pr-4 text-text-secondary">
                {s.p1_leader} vs {s.p2_leader}
              </td>
              <td className="py-2 pr-4 text-right">{s.num_games}</td>
              <td className={`py-2 pr-4 text-right ${highlight(s.stats.p1_win_rate, best.winRate)}`}>
                {formatPct(s.stats.p1_win_rate)}
              </td>
              <td className={`py-2 pr-4 text-right ${highlight(s.stats.avg_turns, best.avgTurns)}`}>
                {s.stats.avg_turns.toFixed(1)}
              </td>
              <td className={`py-2 pr-4 text-right ${highlight(s.stats.avg_p1_damage, best.p1Dmg)}`}>
                {s.stats.avg_p1_damage.toFixed(1)}
              </td>
              <td className={`py-2 pr-4 text-right ${highlight(s.stats.avg_p1_life_remaining, best.p1Life)}`}>
                {s.stats.avg_p1_life_remaining.toFixed(1)}
              </td>
              <td className={`py-2 text-right ${highlight(s.stats.avg_decisions_per_game, best.decPerGame)}`}>
                {s.stats.avg_decisions_per_game.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Win Rate Comparison (grouped bar chart)
// ---------------------------------------------------------------------------

function WinRateChart({ sims }: { sims: SimAnalyticsEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || sims.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    const totalWidth = container?.clientWidth ?? 600;
    const totalHeight = 300;

    const margin = { top: 20, right: 20, bottom: 60, left: 50 };
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;

    svg.attr('width', totalWidth).attr('height', totalHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const labels = sims.map((s) => modelLabel(s));
    const categories = ['P1 Wins', 'P2 Wins', 'Draws'] as const;
    const catColors = ['#0ea5e9', '#f43f5e', '#6b7280'];

    const barData = sims.map((s) => {
      const total = s.num_games || 1;
      const p1 = (s.stats.p1_wins ?? 0) / total;
      const p2 = (s.stats.p2_wins ?? 0) / total;
      const draws = (s.stats.draws ?? 0) / total;
      return { label: modelLabel(s), p1, p2, draws };
    });

    const x0 = d3.scaleBand().domain(labels).range([0, width]).padding(0.3);
    const x1 = d3
      .scaleBand<string>()
      .domain(['p1', 'p2', 'draws'])
      .range([0, x0.bandwidth()])
      .padding(0.08);
    const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickSize(0))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px')
      .attr('transform', 'rotate(-20)')
      .attr('text-anchor', 'end');

    g.selectAll('.domain').attr('stroke', '#374151');

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${(+d * 100).toFixed(0)}%`))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px');

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', '#374151')
      .attr('stroke-opacity', 0.3);
    g.selectAll('.grid .domain').remove();

    // Bars
    const groups = g
      .selectAll('.bar-group')
      .data(barData)
      .enter()
      .append('g')
      .attr('transform', (d) => `translate(${x0(d.label)},0)`);

    const keys: Array<'p1' | 'p2' | 'draws'> = ['p1', 'p2', 'draws'];
    keys.forEach((key, ki) => {
      groups
        .append('rect')
        .attr('x', x1(key)!)
        .attr('y', (d) => y(d[key]))
        .attr('width', x1.bandwidth())
        .attr('height', (d) => height - y(d[key]))
        .attr('rx', 2)
        .attr('fill', catColors[ki])
        .attr('opacity', 0.85);
    });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${margin.left + 10},${margin.top - 5})`);
    categories.forEach((cat, i) => {
      const lg = legend.append('g').attr('transform', `translate(${i * 100},0)`);
      lg.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', catColors[i]);
      lg.append('text')
        .attr('x', 14)
        .attr('y', 9)
        .attr('fill', '#d1d5db')
        .attr('font-size', '11px')
        .text(cat);
    });
  }, [sims]);

  return (
    <GlassCard variant="subtle" className="p-4">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Win Rate Comparison
      </h2>
      <svg ref={svgRef} className="w-full" />
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Section 3: Action Distribution (horizontal stacked bar)
// ---------------------------------------------------------------------------

function ActionDistributionChart({ sims }: { sims: SimAnalyticsEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || sims.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    const totalWidth = container?.clientWidth ?? 600;
    const barHeight = 32;
    const margin = { top: 30, right: 20, bottom: 20, left: 140 };
    const totalHeight = margin.top + margin.bottom + sims.length * (barHeight + 10);
    const width = totalWidth - margin.left - margin.right;

    svg.attr('width', totalWidth).attr('height', totalHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const actionKeys = ['play_card', 'attack', 'pass', 'attach_don'];
    const actionColors: Record<string, string> = {
      play_card: '#0ea5e9',
      attack: '#f43f5e',
      pass: '#6b7280',
      attach_don: '#f59e0b',
    };

    const labels = sims.map((s) => modelLabel(s));
    const y = d3.scaleBand().domain(labels).range([0, sims.length * (barHeight + 10)]).padding(0.2);
    const x = d3.scaleLinear().domain([0, 1]).range([0, width]);

    // Bars
    sims.forEach((s) => {
      const dist = s.stats.action_distribution;
      const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
      let cumulative = 0;

      actionKeys.forEach((key) => {
        const val = (dist[key] ?? 0) / total;
        g.append('rect')
          .attr('x', x(cumulative))
          .attr('y', y(modelLabel(s))!)
          .attr('width', Math.max(0, x(val)))
          .attr('height', y.bandwidth())
          .attr('fill', actionColors[key] ?? '#6b7280')
          .attr('rx', cumulative === 0 ? 3 : 0)
          .attr('opacity', 0.85);

        // Label on segment if big enough
        if (val > 0.08) {
          g.append('text')
            .attr('x', x(cumulative) + x(val) / 2)
            .attr('y', y(modelLabel(s))! + y.bandwidth() / 2 + 4)
            .attr('text-anchor', 'middle')
            .attr('fill', '#fff')
            .attr('font-size', '10px')
            .text(`${(val * 100).toFixed(0)}%`);
        }
        cumulative += val;
      });
    });

    // Y labels
    g.selectAll('.y-label')
      .data(sims)
      .enter()
      .append('text')
      .attr('x', -8)
      .attr('y', (d) => y(modelLabel(d))! + y.bandwidth() / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#d1d5db')
      .attr('font-size', '11px')
      .text((d) => modelLabel(d));

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${margin.left},12)`);
    actionKeys.forEach((key, i) => {
      const lg = legend.append('g').attr('transform', `translate(${i * 110},0)`);
      lg.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', actionColors[key]);
      lg.append('text')
        .attr('x', 14)
        .attr('y', 9)
        .attr('fill', '#d1d5db')
        .attr('font-size', '11px')
        .text(key.replace('_', ' '));
    });
  }, [sims]);

  return (
    <GlassCard variant="subtle" className="p-4">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Action Distribution
      </h2>
      <svg ref={svgRef} className="w-full" />
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Section 4: Game Momentum (line chart)
// ---------------------------------------------------------------------------

function MomentumChart({ sims }: { sims: SimAnalyticsEntry[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || sims.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = svgRef.current.parentElement;
    const totalWidth = container?.clientWidth ?? 600;
    const totalHeight = 320;
    const margin = { top: 20, right: 120, bottom: 40, left: 50 };
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;

    svg.attr('width', totalWidth).attr('height', totalHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Compute momentum = p1_eval - p2_eval per turn
    const allData = sims.map((s) =>
      s.turn_momentum.map((t) => ({
        turn: t.turn,
        gap: t.avg_p1_eval - t.avg_p2_eval,
      })),
    );

    const allTurns = allData.flat();
    const maxTurn = d3.max(allTurns, (d) => d.turn) ?? 10;
    const extentGap = d3.extent(allTurns, (d) => d.gap) as [number, number];
    const absMax = Math.max(Math.abs(extentGap[0] ?? 0), Math.abs(extentGap[1] ?? 0), 1);

    const x = d3.scaleLinear().domain([1, maxTurn]).range([0, width]);
    const y = d3.scaleLinear().domain([-absMax, absMax]).range([height, 0]);

    // Grid
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', '#374151')
      .attr('stroke-opacity', 0.3);
    g.selectAll('.domain').remove();

    // Zero line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', y(0))
      .attr('y2', y(0))
      .attr('stroke', '#6b7280')
      .attr('stroke-dasharray', '4,3')
      .attr('stroke-width', 1);

    // P1 / P2 zone labels
    g.append('text')
      .attr('x', width + 8)
      .attr('y', y(absMax * 0.5))
      .attr('fill', '#0ea5e9')
      .attr('font-size', '10px')
      .text('P1 Advantage');
    g.append('text')
      .attr('x', width + 8)
      .attr('y', y(-absMax * 0.5))
      .attr('fill', '#f43f5e')
      .attr('font-size', '10px')
      .text('P2 Advantage');

    // Lines
    const line = d3
      .line<{ turn: number; gap: number }>()
      .x((d) => x(d.turn))
      .y((d) => y(d.gap))
      .curve(d3.curveMonotoneX);

    allData.forEach((points, i) => {
      g.append('path')
        .datum(points)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', MODEL_COLORS[i % MODEL_COLORS.length])
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.85);
    });

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(Math.min(maxTurn, 10)).tickFormat((d) => `T${d}`))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px');

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text')
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px');

    g.selectAll('.domain').attr('stroke', '#374151');

    // Axis label
    g.append('text')
      .attr('x', width / 2)
      .attr('y', height + 32)
      .attr('text-anchor', 'middle')
      .attr('fill', '#9ca3af')
      .attr('font-size', '11px')
      .text('Turn');

    // Legend (right side)
    const legend = g.append('g').attr('transform', `translate(${width + 8},${height * 0.15})`);
    sims.forEach((s, i) => {
      const lg = legend.append('g').attr('transform', `translate(0,${i * 18})`);
      lg.append('line')
        .attr('x1', 0)
        .attr('x2', 16)
        .attr('y1', 5)
        .attr('y2', 5)
        .attr('stroke', MODEL_COLORS[i % MODEL_COLORS.length])
        .attr('stroke-width', 2);
      lg.append('text')
        .attr('x', 20)
        .attr('y', 9)
        .attr('fill', '#d1d5db')
        .attr('font-size', '10px')
        .text(modelLabel(s));
    });

    // Tooltip overlay
    const tooltip = d3.select(tooltipRef.current);

    const bisect = d3.bisector<{ turn: number; gap: number }, number>((d) => d.turn).left;

    g.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const turnVal = x.invert(mx);

        let tooltipHtml = `<div class="text-xs font-medium mb-1">Turn ${Math.round(turnVal)}</div>`;
        allData.forEach((points, i) => {
          const idx = Math.min(bisect(points, turnVal), points.length - 1);
          const pt = points[idx];
          if (pt) {
            tooltipHtml += `<div style="color:${MODEL_COLORS[i % MODEL_COLORS.length]}" class="text-xs">${modelLabel(sims[i])}: ${pt.gap.toFixed(1)}</div>`;
          }
        });

        tooltip
          .html(tooltipHtml)
          .style('opacity', '1')
          .style('left', `${event.offsetX + 12}px`)
          .style('top', `${event.offsetY - 10}px`);
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', '0');
      });
  }, [sims]);

  return (
    <GlassCard variant="subtle" className="p-4 relative">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Game Momentum (Board Eval Gap)
      </h2>
      <div className="relative">
        <svg ref={svgRef} className="w-full" />
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none bg-surface-2 border border-glass-border rounded-lg px-3 py-2 shadow-lg opacity-0 transition-opacity z-10"
        />
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Section 5: Card Performance Table
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'times_played' | 'games_appeared' | 'win_pct';
type SortDir = 'asc' | 'desc';

function CardPerformanceTable({ sims }: { sims: SimAnalyticsEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('times_played');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const aggregated = useMemo(() => {
    const map = new Map<string, { name: string; times_played: number; games_appeared: number; win_total: number; entries: number }>();
    for (const sim of sims) {
      for (const [, cs] of Object.entries(sim.card_stats)) {
        const existing = map.get(cs.name);
        if (existing) {
          existing.times_played += cs.times_played;
          existing.games_appeared += cs.games_appeared;
          existing.win_total += cs.win_pct * cs.games_appeared;
          existing.entries += cs.games_appeared;
        } else {
          map.set(cs.name, {
            name: cs.name,
            times_played: cs.times_played,
            games_appeared: cs.games_appeared,
            win_total: cs.win_pct * cs.games_appeared,
            entries: cs.games_appeared,
          });
        }
      }
    }
    return Array.from(map.values()).map((v) => ({
      name: v.name,
      times_played: v.times_played,
      games_appeared: v.games_appeared,
      win_pct: v.entries > 0 ? v.win_total / v.entries : 0,
    }));
  }, [sims]);

  const sorted = useMemo(() => {
    const arr = [...aggregated];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr.slice(0, 20);
  }, [aggregated, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ^' : ' v') : '');

  const winColor = (pct: number) => {
    if (pct >= 0.8) return 'text-emerald-400';
    if (pct >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <GlassCard variant="subtle" className="p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Top Card Performance (Aggregated)
      </h2>
      {sorted.length === 0 ? (
        <p className="text-text-muted text-sm">No card stats available.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-muted text-xs uppercase tracking-wider border-b border-glass-border/40">
              <th
                className="text-left py-2 pr-4 cursor-pointer hover:text-text-secondary select-none"
                onClick={() => toggleSort('name')}
              >
                Card Name{arrow('name')}
              </th>
              <th
                className="text-right py-2 pr-4 cursor-pointer hover:text-text-secondary select-none"
                onClick={() => toggleSort('times_played')}
              >
                Times Played{arrow('times_played')}
              </th>
              <th
                className="text-right py-2 pr-4 cursor-pointer hover:text-text-secondary select-none"
                onClick={() => toggleSort('games_appeared')}
              >
                Games{arrow('games_appeared')}
              </th>
              <th
                className="text-right py-2 cursor-pointer hover:text-text-secondary select-none"
                onClick={() => toggleSort('win_pct')}
              >
                Win%{arrow('win_pct')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, idx) => (
              <tr key={`${c.name}-${idx}`} className="border-b border-glass-border/20 hover:bg-white/[0.02]">
                <td className="py-1.5 pr-4 text-text-primary">{c.name}</td>
                <td className="py-1.5 pr-4 text-right text-text-secondary">{c.times_played}</td>
                <td className="py-1.5 pr-4 text-right text-text-secondary">{c.games_appeared}</td>
                <td className={`py-1.5 text-right font-medium ${winColor(c.win_pct)}`}>
                  {formatPct(c.win_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Section 6: Strategic Pattern Cards
// ---------------------------------------------------------------------------

function StrategicPatterns({ sims }: { sims: SimAnalyticsEntry[] }) {
  return (
    <GlassCard variant="subtle" className="p-4">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
        Strategic Patterns
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sims.map((s, i) => (
          <div
            key={s.sim_id}
            className="bg-surface-2/60 border border-glass-border/30 rounded-lg p-4"
          >
            <h3
              className="text-sm font-semibold mb-3"
              style={{ color: MODEL_COLORS[i % MODEL_COLORS.length] }}
            >
              {modelLabel(s)}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <StatChip label="Play-before-attack" value={formatPct(s.stats.play_before_attack_pct)} />
              <StatChip label="DON to Leader" value={formatPct(s.stats.don_to_leader_pct)} />
              <StatChip label="Leader Attack" value={formatPct(s.stats.leader_attack_pct)} />
              <StatChip label="Mulligan P1" value={formatPct(s.stats.p1_mulligan_rate)} />
              <StatChip label="Mulligan P2" value={formatPct(s.stats.p2_mulligan_rate)} />
              <StatChip label="Losing Attack" value={formatPct(s.stats.losing_attack_pct)} />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1/50 rounded px-2.5 py-2 border border-glass-border/20">
      <div className="text-text-muted mb-0.5">{label}</div>
      <div className="text-text-primary font-semibold text-sm">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [sims, setSims] = useState<SimAnalyticsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchSimulationAnalytics();
      setSims(resp.simulations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary">
        <p className="text-red-400">Failed to load analytics: {error}</p>
        <button
          onClick={() => void load()}
          className="px-4 py-2 rounded-lg bg-surface-2 border border-glass-border hover:bg-surface-3 text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-secondary">
        <p className="text-lg font-medium">No simulation data</p>
        <p className="text-sm text-text-muted">
          Run some simulations first, then come back here to compare model performance.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 p-4 pb-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-[var(--font-display)] tracking-wide text-text-primary">
          Simulation Analytics
        </h1>
        <span className="text-xs text-text-muted bg-surface-2 rounded-full px-3 py-1">
          {sims.length} simulation{sims.length !== 1 ? 's' : ''}
        </span>
      </div>

      <ModelOverviewTable sims={sims} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <WinRateChart sims={sims} />
        <ActionDistributionChart sims={sims} />
      </div>

      <MomentumChart sims={sims} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CardPerformanceTable sims={sims} />
        <StrategicPatterns sims={sims} />
      </div>
    </div>
  );
}
