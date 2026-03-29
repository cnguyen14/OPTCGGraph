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
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

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

    // Force simulation
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink<MapNode, MapLink>(links)
          .id((d) => d.id)
          .distance(140),
      )
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => ((d as MapNode).isLeader ? 40 : 28)));

    // Draw edges
    const link = g
      .append('g')
      .selectAll<SVGLineElement, MapLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#475569')
      .attr('stroke-width', (d) => Math.max(1, (d.weight ?? 1) * 0.8))
      .attr('stroke-opacity', 0.4)
      .style('transition', 'stroke-opacity 0.2s, stroke-width 0.2s');

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
            d.fx = null;
            d.fy = null;
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
        // Reset all
        node.select('.card-rect').attr('opacity', 1);
        node.selectAll('text').attr('opacity', 1);
        link.attr('stroke-opacity', 0.4).attr('stroke-width', (d) => Math.max(1, (d.weight ?? 1) * 0.8));
        linkLabel.attr('opacity', 0);
        return;
      }

      const connected = neighbors.get(nodeId) ?? new Set();

      node.each(function (d) {
        const el = d3.select(this);
        if (d.id === nodeId) {
          el.select('.card-rect').attr('opacity', 1);
          el.selectAll('text').attr('opacity', 1);
        } else if (connected.has(d.id)) {
          el.select('.card-rect').attr('opacity', 1);
          el.selectAll('text').attr('opacity', 1);
        } else {
          el.select('.card-rect').attr('opacity', 0.15);
          el.selectAll('text').attr('opacity', 0.15);
        }
      });

      link.each(function (d) {
        const src = typeof d.source === 'object' ? (d.source as MapNode).id : String(d.source);
        const tgt = typeof d.target === 'object' ? (d.target as MapNode).id : String(d.target);
        const isConnected = src === nodeId || tgt === nodeId;
        d3.select(this)
          .attr('stroke-opacity', isConnected ? 0.9 : 0.05)
          .attr('stroke-width', isConnected ? 3 : 1);
      });

      linkLabel.each(function (d) {
        const src = typeof d.source === 'object' ? (d.source as MapNode).id : String(d.source);
        const tgt = typeof d.target === 'object' ? (d.target as MapNode).id : String(d.target);
        const isConnected = src === nodeId || tgt === nodeId;
        d3.select(this).attr('opacity', isConnected ? 1 : 0);
      });
    }

    // Click handlers
    node.on('click', (event, d) => {
      event.stopPropagation();
      const newSelected = selectedNode === d.id ? null : d.id;
      setSelectedNode(newSelected);
      highlight(newSelected);
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
      setSelectedNode(null);
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
  }, [leader, entries, edges, selectedNode]);

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

      {/* Help text */}
      <div className="absolute bottom-3 left-3 text-[10px] text-gray-600 bg-gray-900/80 rounded px-2 py-1">
        Click to highlight connections &middot; Double-click to view card &middot; Scroll to zoom &middot; Drag to move
      </div>
    </div>
  );
}
