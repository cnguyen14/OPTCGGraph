import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Card, DeckEntry } from '../../types';
import { fetchDeckSynergies } from '../../lib/api';
import type { DeckSynergyEdge } from '../../lib/api';

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#6b7280',
  Yellow: '#eab308',
};

const EDGE_COLORS: Record<string, string> = {
  SYNERGY: '#3b82f6',
  MECHANICAL_SYNERGY: '#a855f7',
  CURVES_INTO: '#22c55e',
};

interface MapNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  card_type: string;
  cost: number | null;
  color: string;
  image_small: string;
  quantity: number;
  isLeader: boolean;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface MapLink extends d3.SimulationLinkDatum<MapNode> {
  type: string;
  weight: number | null;
  label: string;
}

interface Props {
  leader: Card | null;
  entries: Map<string, DeckEntry>;
  onCardSelect: (card: Card) => void;
}

export default function DeckMap({ leader, entries, onCardSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(false);
  const [edges, setEdges] = useState<DeckSynergyEdge[]>([]);
  const [hoverCard, setHoverCard] = useState<{ node: MapNode; x: number; y: number } | null>(null);
  const [connCounts, setConnCounts] = useState<Map<string, number>>(new Map());
  const [showAllEdges, setShowAllEdges] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const highlightRef = useRef<((id: string | null) => void) | null>(null);

  // Fetch synergy edges when deck changes
  useEffect(() => {
    const cardIds = Array.from(entries.keys());
    if (leader) cardIds.push(leader.id);

    if (cardIds.length < 2) {
      setEdges([]);
      return;
    }

    setLoading(true);
    fetchDeckSynergies(cardIds)
      .then((res) => {
        setEdges(res.edges ?? []);
        setLoading(false);
      })
      .catch(() => {
        setEdges([]);
        setLoading(false);
      });
  }, [leader, entries]);

  // Render D3 graph
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Build nodes
    const nodes: MapNode[] = [];

    if (leader) {
      const colors = leader.colors?.length ? leader.colors : leader.color ? [leader.color] : [];
      nodes.push({
        id: leader.id,
        name: leader.name,
        card_type: leader.card_type,
        cost: leader.cost,
        color: colors[0] || '',
        image_small: leader.image_small,
        quantity: 1,
        isLeader: true,
      });
    }

    for (const [, { card, quantity }] of entries) {
      if (leader && card.id === leader.id) continue;
      const colors = card.colors?.length ? card.colors : card.color ? [card.color] : [];
      nodes.push({
        id: card.id,
        name: card.name,
        card_type: card.card_type,
        cost: card.cost,
        color: colors[0] || '',
        image_small: card.image_small,
        quantity,
        isLeader: false,
      });
    }

    if (nodes.length === 0) return;

    // Build links (only between nodes that exist)
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: MapLink[] = edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => {
        let label = e.type.replace('_', ' ');
        if (e.shared_families?.length) label = e.shared_families.join(', ');
        else if (e.shared_keywords?.length) label = e.shared_keywords.join(', ');
        else if (e.cost_diff !== undefined) label = `Cost +${e.cost_diff}`;
        return {
          source: e.source,
          target: e.target,
          type: e.type,
          weight: e.weight,
          label,
        };
      });

    // Build adjacency map
    const neighbors = new Map<string, Set<string>>();
    nodes.forEach((n) => neighbors.set(n.id, new Set()));
    links.forEach((l) => {
      const src = typeof l.source === 'object' ? (l.source as MapNode).id : String(l.source);
      const tgt = typeof l.target === 'object' ? (l.target as MapNode).id : String(l.target);
      neighbors.get(src)?.add(tgt);
      neighbors.get(tgt)?.add(src);
    });

    // Count connections per node
    const connectionCount = new Map<string, number>();
    nodes.forEach((n) => connectionCount.set(n.id, neighbors.get(n.id)?.size ?? 0));
    setConnCounts(connectionCount);

    // SVG setup
    const defs = svg.append('defs');

    // Glow filter
    const glow = defs.append('filter').attr('id', 'glow-map');
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Card image patterns
    nodes.forEach((n) => {
      if (n.image_small) {
        defs
          .append('pattern')
          .attr('id', `img-${n.id.replace(/[^a-zA-Z0-9]/g, '_')}`)
          .attr('width', 1)
          .attr('height', 1)
          .append('image')
          .attr('href', n.image_small)
          .attr('width', n.isLeader ? 56 : 40)
          .attr('height', n.isLeader ? 78 : 56)
          .attr('preserveAspectRatio', 'xMidYMid slice');
      }
    });

    const g = svg.append('g');

    // Zoom
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => g.attr('transform', event.transform as unknown as string)),
    );

    // Mind Map radial layout: Leader at center, cards in cost-tier rings
    const cx = width / 2;
    const cy = height / 2;

    // Group cards by cost tier
    const tiers: Record<string, MapNode[]> = { leader: [], low: [], mid: [], high: [], ultra: [] };
    for (const n of nodes) {
      if (n.isLeader) { tiers.leader.push(n); continue; }
      const cost = n.cost ?? 0;
      if (cost <= 2) tiers.low.push(n);
      else if (cost <= 5) tiers.mid.push(n);
      else if (cost <= 9) tiers.high.push(n);
      else tiers.ultra.push(n);
    }

    // Sort each tier by connections (most connected first) for better visual
    for (const tier of Object.values(tiers)) {
      tier.sort((a, b) => (connectionCount.get(b.id) ?? 0) - (connectionCount.get(a.id) ?? 0));
    }

    // Place nodes in concentric rings
    const ringRadii = { leader: 0, low: 160, mid: 300, high: 430, ultra: 530 };
    for (const [tierName, tierNodes] of Object.entries(tiers)) {
      const radius = ringRadii[tierName as keyof typeof ringRadii] ?? 300;
      const count = tierNodes.length;
      if (count === 0) continue;
      if (tierName === 'leader') {
        tierNodes[0].fx = cx;
        tierNodes[0].fy = cy;
        tierNodes[0].x = cx;
        tierNodes[0].y = cy;
        continue;
      }
      // Distribute evenly around the ring, with a slight offset per tier
      const offset = tierName === 'mid' ? Math.PI / (count + 1) * 0.5 : 0;
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2 + offset;
        tierNodes[i].fx = cx + radius * Math.cos(angle);
        tierNodes[i].fy = cy + radius * Math.sin(angle);
        tierNodes[i].x = tierNodes[i].fx;
        tierNodes[i].y = tierNodes[i].fy;
      }
    }

    // Gentle force simulation — nodes are pinned (fx/fy) but edges still animate
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink<MapNode, MapLink>(links)
          .id((d) => d.id)
          .distance(100),
      )
      .alpha(0.05)  // Very low alpha — layout is pre-computed
      .alphaDecay(0.1);

    // Draw tier ring guides
    const tierLabels = [
      { r: ringRadii.low, label: 'Cost 0-2', count: tiers.low.length },
      { r: ringRadii.mid, label: 'Cost 3-5', count: tiers.mid.length },
      { r: ringRadii.high, label: 'Cost 6-9', count: tiers.high.length },
      { r: ringRadii.ultra, label: 'Cost 10+', count: tiers.ultra.length },
    ];
    for (const { r, label, count } of tierLabels) {
      if (count === 0) continue;
      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', r)
        .attr('fill', 'none')
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4');
      g.append('text')
        .attr('x', cx + r + 5).attr('y', cy - 5)
        .attr('font-size', '9px')
        .attr('fill', '#334155')
        .text(`${label} (${count})`);
    }

    // Draw edges
    const link = g
      .append('g')
      .selectAll<SVGLineElement, MapLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#475569')
      .attr('stroke-width', (d) => Math.max(1, (d.weight ?? 1) * 0.8))
      .attr('stroke-opacity', 0)  // Hidden by default — shown on click
      .style('transition', 'stroke-opacity 0.3s, stroke-width 0.3s');

    // Edge labels
    const linkLabel = g
      .append('g')
      .selectAll<SVGTextElement, MapLink>('text')
      .data(links)
      .join('text')
      .text((d) => d.label)
      .attr('font-size', '7px')
      .attr('fill', '#64748b')
      .attr('text-anchor', 'middle')
      .attr('opacity', 0);

    // Draw nodes
    const node = g
      .append('g')
      .selectAll<SVGGElement, MapNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, MapNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // Keep position where user dropped it
            d.fx = event.x;
            d.fy = event.y;
          }),
      );

    // Card image rectangles
    node
      .append('rect')
      .attr('class', 'card-rect')
      .attr('width', (d) => (d.isLeader ? 56 : 40))
      .attr('height', (d) => (d.isLeader ? 78 : 56))
      .attr('x', (d) => (d.isLeader ? -28 : -20))
      .attr('y', (d) => (d.isLeader ? -39 : -28))
      .attr('rx', 4)
      .attr('fill', (d) =>
        d.image_small
          ? `url(#img-${d.id.replace(/[^a-zA-Z0-9]/g, '_')})`
          : COLOR_MAP[d.color] ?? '#374151',
      )
      .attr('stroke', (d) => {
        const conn = connectionCount.get(d.id) ?? 0;
        if (d.isLeader) return '#fbbf24';
        if (conn === 0) return '#ef4444'; // Red border for disconnected cards
        return COLOR_MAP[d.color] ?? '#475569';
      })
      .attr('stroke-width', (d) => {
        const c = connectionCount.get(d.id) ?? 0;
        return d.isLeader ? 3 : c === 0 ? 2.5 : 1.5;
      })
      .style('transition', 'stroke-width 0.2s, opacity 0.2s');

    function conn(d: MapNode): number {
      return connectionCount.get(d.id) ?? 0;
    }

    // Warning icon for disconnected cards
    node
      .filter((d) => !d.isLeader && conn(d) === 0)
      .append('text')
      .attr('x', (d) => (d.isLeader ? 22 : 14))
      .attr('y', (d) => (d.isLeader ? -30 : -20))
      .attr('font-size', '14px')
      .attr('fill', '#ef4444')
      .text('!');

    // Quantity badge
    node
      .filter((d) => d.quantity > 1)
      .append('circle')
      .attr('cx', (d) => (d.isLeader ? 24 : 16))
      .attr('cy', (d) => (d.isLeader ? -32 : -22))
      .attr('r', 8)
      .attr('fill', '#3b82f6')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 1.5);

    node
      .filter((d) => d.quantity > 1)
      .append('text')
      .attr('x', (d) => (d.isLeader ? 24 : 16))
      .attr('y', (d) => (d.isLeader ? -28 : -18))
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .text((d) => d.quantity);

    // Name label
    node
      .append('text')
      .attr('y', (d) => (d.isLeader ? 50 : 38))
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => (d.isLeader ? '11px' : '9px'))
      .attr('font-weight', (d) => (d.isLeader ? '600' : '400'))
      .attr('fill', '#e2e8f0')
      .text((d) => (d.name.length > 16 ? d.name.slice(0, 14) + '...' : d.name));

    // Cost badge
    node
      .filter((d) => d.cost !== null && !d.isLeader)
      .append('circle')
      .attr('cx', (d) => (d.isLeader ? -24 : -16))
      .attr('cy', (d) => (d.isLeader ? -32 : -22))
      .attr('r', 7)
      .attr('fill', '#1e293b')
      .attr('stroke', '#475569')
      .attr('stroke-width', 1);

    node
      .filter((d) => d.cost !== null && !d.isLeader)
      .append('text')
      .attr('x', (d) => (d.isLeader ? -24 : -16))
      .attr('y', (d) => (d.isLeader ? -28 : -18))
      .attr('text-anchor', 'middle')
      .attr('font-size', '8px')
      .attr('font-weight', 'bold')
      .attr('fill', 'white')
      .text((d) => d.cost ?? '');

    // Type label under name
    node
      .append('text')
      .attr('y', (d) => (d.isLeader ? 62 : 48))
      .attr('text-anchor', 'middle')
      .attr('font-size', '7px')
      .attr('fill', '#64748b')
      .text((d) => d.card_type);

    // Highlighting logic
    function highlight(nodeId: string | null) {
      if (!nodeId) {
        // Reset: all nodes bright, all edges hidden
        node.select('.card-rect').attr('opacity', 1).attr('filter', null);
        node.selectAll('text').attr('opacity', 1);
        link.attr('stroke-opacity', 0);
        linkLabel.attr('opacity', 0);
        return;
      }

      const connected = neighbors.get(nodeId) ?? new Set();

      node.each(function (d) {
        const el = d3.select(this);
        const isSelected = d.id === nodeId;
        const isConnected = connected.has(d.id);
        const active = isSelected || isConnected;

        el.select('.card-rect')
          .attr('opacity', active ? 1 : 0.1)
          .attr('filter', isSelected ? 'url(#glow-map)' : null);
        el.selectAll('text').attr('opacity', active ? 1 : 0.1);
      });

      link.each(function (d) {
        const src = typeof d.source === 'object' ? (d.source as MapNode).id : String(d.source);
        const tgt = typeof d.target === 'object' ? (d.target as MapNode).id : String(d.target);
        const isActive = src === nodeId || tgt === nodeId;
        d3.select(this)
          .attr('stroke-opacity', isActive ? 0.85 : 0)
          .attr('stroke-width', isActive ? 2.5 : 1);
      });

      linkLabel.each(function (d) {
        const src = typeof d.source === 'object' ? (d.source as MapNode).id : String(d.source);
        const tgt = typeof d.target === 'object' ? (d.target as MapNode).id : String(d.target);
        d3.select(this).attr('opacity', (src === nodeId || tgt === nodeId) ? 1 : 0);
      });
    }

    // Store highlight function in ref so toggle can call it
    highlightRef.current = highlight;

    // Click handlers
    node.on('click', (event, d) => {
      event.stopPropagation();
      const newSelected = selectedRef.current === d.id ? null : d.id;
      selectedRef.current = newSelected;
      highlight(newSelected);
    });

    // Hover tooltip
    node.on('mouseenter', (event, d) => {
      const rect = svgRef.current!.getBoundingClientRect();
      setHoverCard({
        node: d,
        x: event.clientX - rect.left + 15,
        y: event.clientY - rect.top - 10,
      });
    });

    node.on('mouseleave', () => {
      setHoverCard(null);
    });

    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      // Find the card object
      if (d.isLeader && leader) {
        onCardSelect(leader);
      } else {
        const entry = entries.get(d.id);
        if (entry) onCardSelect(entry.card);
      }
    });

    svg.on('click', () => {
      selectedRef.current = null;
      highlight(null);
    });

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as MapNode).x!)
        .attr('y1', (d) => (d.source as MapNode).y!)
        .attr('x2', (d) => (d.target as MapNode).x!)
        .attr('y2', (d) => (d.target as MapNode).y!);

      linkLabel
        .attr('x', (d) => ((d.source as MapNode).x! + (d.target as MapNode).x!) / 2)
        .attr('y', (d) => ((d.source as MapNode).y! + (d.target as MapNode).y!) / 2);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leader, entries, edges]);

  // Toggle all edges on/off
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    if (showAllEdges) {
      svg.selectAll<SVGLineElement, MapLink>('line')
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', 1.5);
    } else {
      // If no node selected, hide all; if selected, re-highlight
      if (selectedRef.current && highlightRef.current) {
        highlightRef.current(selectedRef.current);
      } else {
        svg.selectAll<SVGLineElement, MapLink>('line').attr('stroke-opacity', 0);
      }
    }
  }, [showAllEdges]);

  const totalCards = Array.from(entries.values()).reduce((s, e) => s + e.quantity, 0);
  const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
  const allIds = new Set(Array.from(entries.keys()));
  if (leader) allIds.add(leader.id);
  const disconnectedCount = Array.from(allIds).filter((id) => !connectedIds.has(id) && id !== leader?.id).length;

  if (!leader && entries.size === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg">Deck Map</p>
          <p className="text-sm mt-1">Add cards to your deck to see the synergy map</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Stats bar */}
      <div className="shrink-0 bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-4 text-xs">
        <span className="text-gray-400">
          {totalCards + (leader ? 1 : 0)} nodes &middot; {edges.length} connections
        </span>
        {disconnectedCount > 0 && (
          <span className="text-red-400">
            {disconnectedCount} card{disconnectedCount > 1 ? 's' : ''} with no synergy
          </span>
        )}
        <div className="flex items-center gap-3 ml-auto">
          {/* Toggle connections */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-gray-500">Connections</span>
            <button
              onClick={() => setShowAllEdges(prev => !prev)}
              className={`relative w-8 h-4 rounded-full transition-colors ${showAllEdges ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showAllEdges ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: EDGE_COLORS.SYNERGY }} />
            <span className="text-gray-500">Family</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: EDGE_COLORS.MECHANICAL_SYNERGY }} />
            <span className="text-gray-500">Keyword</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: EDGE_COLORS.CURVES_INTO }} />
            <span className="text-gray-500">Curve</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm border-2 border-red-500 inline-block" />
            <span className="text-gray-500">No synergy</span>
          </span>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/50">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}

      {/* D3 SVG */}
      <svg ref={svgRef} className="flex-1 w-full bg-gray-950" />

      {/* Hover Tooltip — large preview */}
      {hoverCard && (
        <div
          className="absolute z-20 pointer-events-none bg-gray-800/95 border border-gray-600 rounded-xl shadow-2xl p-4 w-72 backdrop-blur-sm"
          style={{ left: hoverCard.x, top: hoverCard.y }}
        >
          <div className="flex gap-3">
            {hoverCard.node.image_small && (
              <img src={hoverCard.node.image_small} alt="" className="w-24 h-[134px] rounded-lg object-cover shrink-0" />
            )}
            <div className="min-w-0 flex flex-col justify-between py-0.5">
              <div>
                <p className="text-white text-sm font-bold leading-tight">{hoverCard.node.name}</p>
                <p className="text-gray-400 text-xs mt-1">{hoverCard.node.id}</p>
                <p className="text-gray-500 text-xs">{hoverCard.node.card_type}</p>
              </div>
              <div className="space-y-1 mt-2">
                <div className="flex gap-3 text-xs">
                  {hoverCard.node.cost !== null && (
                    <span className="bg-gray-700 rounded px-1.5 py-0.5 text-blue-300">Cost {hoverCard.node.cost}</span>
                  )}
                  <span className="bg-gray-700 rounded px-1.5 py-0.5 text-gray-300">{hoverCard.node.quantity}x</span>
                </div>
                <p className="text-gray-400 text-xs">{(connCounts.get(hoverCard.node.id) ?? 0)} synergy connections</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="absolute bottom-3 left-3 text-[10px] text-gray-600 bg-gray-900/80 rounded px-2 py-1">
        Click to highlight connections &middot; Double-click to view card &middot; Scroll to zoom &middot; Drag to move
      </div>
    </div>
  );
}
