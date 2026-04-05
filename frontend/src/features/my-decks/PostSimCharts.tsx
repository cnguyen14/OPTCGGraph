import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { DetailedSimStats } from '../../types';
import { GlassCard } from '../../components/ui';

// ---------------------------------------------------------------------------
// Color palette (glass theme)
// ---------------------------------------------------------------------------
const BLUE = '#0ea5e9';
const RED = '#f43f5e';
const GRAY = '#6b7280';
const GREEN = '#22c55e';
const RED_BAD = '#ef4444';
const LABEL_COLOR = '#94a3b8';
const VALUE_COLOR = '#ffffff';

// ---------------------------------------------------------------------------
// Chart A: Card Performance Horizontal Bars
// ---------------------------------------------------------------------------

function CardPerformanceBars({ stats }: { stats: DetailedSimStats }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const cards = [...stats.card_performance]
      .sort((a, b) => b.play_rate - a.play_rate)
      .slice(0, 15);

    if (cards.length === 0) return;

    const sel = d3.select(svg);
    sel.selectAll('*').remove();

    const margin = { top: 8, right: 80, bottom: 8, left: 140 };
    const barHeight = 24;
    const gap = 4;
    const height = cards.length * (barHeight + gap) + margin.top + margin.bottom;
    const width = container.clientWidth || 500;
    const innerW = width - margin.left - margin.right;

    sel.attr('width', width).attr('height', height);

    const g = sel.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxRate = d3.max(cards, (d) => d.play_rate) ?? 1;
    const x = d3.scaleLinear().domain([0, maxRate]).range([0, innerW]);

    const colorScale = d3
      .scaleLinear<string>()
      .domain([0, 50, 100])
      .range([RED_BAD, '#eab308', GREEN])
      .clamp(true);

    cards.forEach((card, i) => {
      const y = i * (barHeight + gap);

      // Bar
      g.append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', x(card.play_rate))
        .attr('height', barHeight)
        .attr('rx', 4)
        .attr('fill', colorScale(card.win_pct));

      // Left label (card name)
      g.append('text')
        .attr('x', -6)
        .attr('y', y + barHeight / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('fill', LABEL_COLOR)
        .attr('font-size', '11px')
        .text(card.card_name.length > 20 ? card.card_name.slice(0, 18) + '...' : card.card_name);

      // Right label (win_pct + avg turn)
      g.append('text')
        .attr('x', innerW + 6)
        .attr('y', y + barHeight / 2)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', VALUE_COLOR)
        .attr('font-size', '11px')
        .text(`${Math.round(card.win_pct)}% T${card.avg_turn_played.toFixed(1)}`);
    });
  }, [stats]);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto">
      <svg ref={svgRef} className="w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart B: Game Momentum Line
// ---------------------------------------------------------------------------

function MomentumChart({ stats }: { stats: DetailedSimStats }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const data = stats.turn_momentum;
    if (data.length === 0) return;

    const sel = d3.select(svg);
    sel.selectAll('*').remove();

    const margin = { top: 16, right: 16, bottom: 28, left: 40 };
    const width = container.clientWidth || 500;
    const height = 200;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    sel.attr('width', width).attr('height', height);

    const g = sel.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const evalGap = data.map((d) => ({
      turn: d.turn,
      gap: d.avg_p1_eval - d.avg_p2_eval,
    }));

    const x = d3
      .scaleLinear()
      .domain(d3.extent(evalGap, (d) => d.turn) as [number, number])
      .range([0, innerW]);

    const maxAbs = d3.max(evalGap, (d) => Math.abs(d.gap)) ?? 1;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([innerH, 0]);

    // Dashed zero line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', y(0))
      .attr('y2', y(0))
      .attr('stroke', GRAY)
      .attr('stroke-dasharray', '4,3')
      .attr('stroke-width', 1);

    // Area above zero (P1 advantage - blue)
    const areaAbove = d3
      .area<{ turn: number; gap: number }>()
      .x((d) => x(d.turn))
      .y0(y(0))
      .y1((d) => y(Math.max(0, d.gap)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(evalGap)
      .attr('d', areaAbove)
      .attr('fill', BLUE)
      .attr('fill-opacity', 0.2);

    // Area below zero (P2 advantage - red)
    const areaBelow = d3
      .area<{ turn: number; gap: number }>()
      .x((d) => x(d.turn))
      .y0(y(0))
      .y1((d) => y(Math.min(0, d.gap)))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(evalGap)
      .attr('d', areaBelow)
      .attr('fill', RED)
      .attr('fill-opacity', 0.2);

    // Line
    const line = d3
      .line<{ turn: number; gap: number }>()
      .x((d) => x(d.turn))
      .y((d) => y(d.gap))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(evalGap)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', VALUE_COLOR)
      .attr('stroke-width', 1.5);

    // Axes
    const xAxis = d3
      .axisBottom(x)
      .ticks(Math.min(data.length, 10))
      .tickFormat((d) => `T${d}`);
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', LABEL_COLOR)
      .attr('font-size', '10px');
    g.selectAll('.domain, .tick line').attr('stroke', GRAY).attr('stroke-opacity', 0.4);

    const yAxis = d3.axisLeft(y).ticks(5);
    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', LABEL_COLOR)
      .attr('font-size', '10px');

    // Labels
    g.append('text')
      .attr('x', innerW)
      .attr('y', y(maxAbs * 0.8))
      .attr('text-anchor', 'end')
      .attr('fill', BLUE)
      .attr('font-size', '10px')
      .attr('opacity', 0.7)
      .text('P1 Advantage');

    g.append('text')
      .attr('x', innerW)
      .attr('y', y(-maxAbs * 0.8))
      .attr('text-anchor', 'end')
      .attr('fill', RED)
      .attr('font-size', '10px')
      .attr('opacity', 0.7)
      .text('P2 Advantage');
  }, [stats]);

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} className="w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart C: Action Pattern Stats
// ---------------------------------------------------------------------------

function ActionPatternStats({ stats }: { stats: DetailedSimStats }) {
  const { action_patterns: ap } = stats;

  const fmt = (v: number | undefined) => v != null ? `${Math.round(v * 100)}%` : 'N/A';
  const items: Array<{ label: string; value: string }> = [
    { label: 'Play before Attack', value: fmt(ap.play_before_attack_pct) },
    { label: 'Leader Attack', value: fmt(ap.leader_attack_pct) },
    { label: 'Losing Attack', value: fmt(ap.losing_attack_pct) },
    { label: 'Avg Decisions/Game', value: ap.avg_decisions_per_game?.toFixed(1) ?? 'N/A' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((item) => (
        <GlassCard key={item.label} variant="subtle" className="p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">{item.label}</p>
          <p className="text-lg font-semibold text-text-primary">{item.value}</p>
        </GlassCard>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostSimCharts — main export
// ---------------------------------------------------------------------------

export default function PostSimCharts({ stats }: { stats: DetailedSimStats }) {
  return (
    <GlassCard className="p-4 space-y-5">
      <h4 className="text-sm font-semibold text-text-primary tracking-wide">Performance Analysis</h4>

      {/* Chart A: Card Performance */}
      {stats.card_performance.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            Card Play Rate &amp; Win Contribution
          </p>
          <CardPerformanceBars stats={stats} />
        </div>
      )}

      {/* Chart B: Momentum */}
      {stats.turn_momentum.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            Game Momentum (Eval Gap)
          </p>
          <MomentumChart stats={stats} />
        </div>
      )}

      {/* Chart C: Action Patterns */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Action Patterns</p>
        <ActionPatternStats stats={stats} />
      </div>
    </GlassCard>
  );
}
