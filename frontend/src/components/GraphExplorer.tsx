import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { fetchCard, fetchSynergies } from '../lib/api';
import type { Card } from '../types';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  group: string;
  card_type?: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  type: string;
}

interface Props {
  onCardSelect: (card: Card) => void;
}

const COLOR_MAP: Record<string, string> = {
  Red: '#ef4444', Green: '#22c55e', Blue: '#3b82f6',
  Purple: '#a855f7', Black: '#6b7280', Yellow: '#eab308',
};

// Brighten a hex color
function brighten(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const br = (c: number) => Math.min(255, Math.round(c + (255 - c) * factor));
  return `rgb(${br(r)}, ${br(g)}, ${br(b)})`;
}

export default function GraphExplorer({ onCardSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [searchId, setSearchId] = useState('OP01-001');
  const [loading, setLoading] = useState(false);

  const loadGraph = async (cardId: string) => {
    setLoading(true);
    try {
      const [card, synergies] = await Promise.all([
        fetchCard(cardId),
        fetchSynergies(cardId, 1),
      ]);

      const nodes: Node[] = [
        { id: card.id, name: card.name, group: card.colors?.[0] || 'Unknown', card_type: card.card_type },
      ];
      const links: Link[] = [];

      for (const p of (synergies.partners || []).slice(0, 30)) {
        nodes.push({ id: p.id, name: p.name, group: p.color || 'Unknown', card_type: p.card_type });
        links.push({ source: card.id, target: p.id, type: 'SYNERGY' });
      }

      renderGraph(nodes, links, card, onCardSelect);
    } catch (err) {
      console.error('Failed to load graph:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderGraph = (nodes: Node[], links: Link[], centerCard: Card, onSelect: (c: Card) => void) => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current?.clientWidth || 800;
    const height = svgRef.current?.clientHeight || 600;

    // Defs for glow filter
    const defs = svg.append('defs');
    const glowFilter = defs.append('filter').attr('id', 'glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svg.call(d3.zoom<any, any>()
      .scaleExtent([0.3, 5])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => g.attr('transform', event.transform as unknown as string))
    );

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-250))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Edge lines
    const link = g.selectAll('.link')
      .data(links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#1e293b')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', 1.5)
      .style('transition', 'stroke 0.3s, stroke-opacity 0.3s, stroke-width 0.3s');

    // Node groups
    const node = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(d3.drag<any, Node>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    // Outer glow ring (hidden by default, shown on highlight)
    node.append('circle')
      .attr('class', 'glow-ring')
      .attr('r', d => (d.id === centerCard.id ? 22 : 16))
      .attr('fill', 'none')
      .attr('stroke', d => COLOR_MAP[d.group] || '#6b7280')
      .attr('stroke-width', 0)
      .attr('stroke-opacity', 0)
      .style('transition', 'stroke-width 0.3s, stroke-opacity 0.3s')
      .attr('filter', 'url(#glow)');

    // Main circle
    node.append('circle')
      .attr('class', 'main-circle')
      .attr('r', d => d.id === centerCard.id ? 16 : 10)
      .attr('fill', d => COLOR_MAP[d.group] || '#6b7280')
      .attr('stroke', d => d.id === centerCard.id ? '#fff' : '#0f172a')
      .attr('stroke-width', d => d.id === centerCard.id ? 2.5 : 1.5)
      .style('transition', 'r 0.3s, fill 0.3s, stroke 0.3s, stroke-width 0.3s');

    // Labels
    node.append('text')
      .attr('class', 'node-label')
      .text(d => d.name.length > 18 ? d.name.slice(0, 18) + '...' : d.name)
      .attr('x', d => d.id === centerCard.id ? 20 : 14)
      .attr('y', 4)
      .attr('fill', '#4b5563')
      .attr('font-size', '10px')
      .attr('font-weight', '400')
      .style('transition', 'fill 0.3s, font-weight 0.3s');

    // Build adjacency for fast neighbor lookup
    const neighbors = new Map<string, Set<string>>();
    links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : (l.source as Node).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as Node).id;
      if (!neighbors.has(src)) neighbors.set(src, new Set());
      if (!neighbors.has(tgt)) neighbors.set(tgt, new Set());
      neighbors.get(src)!.add(tgt);
      neighbors.get(tgt)!.add(src);
    });

    const isNeighbor = (a: string, b: string) => neighbors.get(a)?.has(b) ?? false;
    const isConnected = (nodeId: string, l: Link) => {
      const src = typeof l.source === 'string' ? l.source : (l.source as Node).id;
      const tgt = typeof l.target === 'string' ? l.target : (l.target as Node).id;
      return src === nodeId || tgt === nodeId;
    };

    let selectedId: string | null = null;

    function highlight(nodeId: string | null) {
      selectedId = nodeId;

      if (!nodeId) {
        // Reset all to default
        node.select('.main-circle')
          .attr('r', (d: Node) => d.id === centerCard.id ? 16 : 10)
          .attr('fill', (d: Node) => COLOR_MAP[d.group] || '#6b7280')
          .attr('stroke', (d: Node) => d.id === centerCard.id ? '#fff' : '#0f172a')
          .attr('stroke-width', (d: Node) => d.id === centerCard.id ? 2.5 : 1.5)
          .attr('opacity', 1);

        node.select('.glow-ring')
          .attr('stroke-width', 0)
          .attr('stroke-opacity', 0);

        node.select('.node-label')
          .attr('fill', '#4b5563')
          .attr('font-weight', '400')
          .attr('font-size', '10px');

        link
          .attr('stroke', '#1e293b')
          .attr('stroke-opacity', 0.4)
          .attr('stroke-width', 1.5);

        node.attr('opacity', 1);
        return;
      }

      // Dim everything, then highlight selected + neighbors
      node.each(function (d: Node) {
        const el = d3.select(this);
        const isSelected = d.id === nodeId;
        const isAdj = isNeighbor(nodeId, d.id);
        const active = isSelected || isAdj;

        el.attr('opacity', active ? 1 : 0.15);

        el.select('.main-circle')
          .attr('r', isSelected ? 18 : isAdj ? 12 : 10)
          .attr('fill', active ? brighten(COLOR_MAP[d.group] || '#6b7280', isSelected ? 0.3 : 0.1) : COLOR_MAP[d.group] || '#6b7280')
          .attr('stroke', isSelected ? '#fff' : isAdj ? brighten(COLOR_MAP[d.group] || '#6b7280', 0.5) : '#0f172a')
          .attr('stroke-width', isSelected ? 3 : isAdj ? 2 : 1.5);

        el.select('.glow-ring')
          .attr('stroke', COLOR_MAP[d.group] || '#6b7280')
          .attr('stroke-width', isSelected ? 6 : isAdj ? 3 : 0)
          .attr('stroke-opacity', isSelected ? 0.6 : isAdj ? 0.3 : 0);

        el.select('.node-label')
          .attr('fill', isSelected ? '#fff' : isAdj ? '#d1d5db' : '#4b5563')
          .attr('font-weight', isSelected ? '700' : isAdj ? '500' : '400')
          .attr('font-size', isSelected ? '12px' : '10px');
      });

      link.each(function (l: Link) {
        const el = d3.select(this);
        const active = isConnected(nodeId, l);
        const src = typeof l.source === 'string' ? l.source : (l.source as Node).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as Node).id;
        const otherNode = src === nodeId ? nodes.find(n => n.id === tgt) : nodes.find(n => n.id === src);
        const edgeColor = otherNode ? (COLOR_MAP[otherNode.group] || '#6b7280') : '#6b7280';

        el
          .attr('stroke', active ? brighten(edgeColor, 0.3) : '#1e293b')
          .attr('stroke-opacity', active ? 0.9 : 0.05)
          .attr('stroke-width', active ? 2.5 : 1.5);
      });
    }

    // Click to highlight, click again or background to deselect
    node.on('click', async (event, d) => {
      event.stopPropagation();

      // Toggle highlight
      if (selectedId === d.id) {
        highlight(null);
      } else {
        highlight(d.id);
      }

      // Also open card detail
      try {
        const card = await fetchCard(d.id);
        onSelect(card);
      } catch {}
    });

    // Click background to clear
    svg.on('click', () => highlight(null));

    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      loadGraph(d.id);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x!)
        .attr('y1', d => (d.source as Node).y!)
        .attr('x2', d => (d.target as Node).x!)
        .attr('y2', d => (d.target as Node).y!);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });
  };

  useEffect(() => { loadGraph(searchId); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-3 border-b border-gray-800">
        <input
          type="text"
          value={searchId}
          onChange={e => setSearchId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadGraph(searchId)}
          placeholder="Card ID (e.g. OP01-001)"
          className="bg-gray-800 text-white rounded px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => loadGraph(searchId)}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-1.5 text-sm"
        >
          {loading ? '...' : 'Explore'}
        </button>
      </div>
      <svg ref={svgRef} className="flex-1 w-full bg-gray-950" />
    </div>
  );
}
