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

    const g = svg.append('g');

    // Zoom
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svg.call(d3.zoom<any, any>()
      .scaleExtent([0.3, 5])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => g.attr('transform', event.transform as unknown as string))
    );

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(25));

    const link = g.selectAll('.link')
      .data(links)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', '#374151')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 1);

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

    node.append('circle')
      .attr('r', d => d.id === centerCard.id ? 16 : 10)
      .attr('fill', d => COLOR_MAP[d.group] || '#6b7280')
      .attr('stroke', d => d.id === centerCard.id ? '#fff' : 'none')
      .attr('stroke-width', 2);

    node.append('text')
      .text(d => d.name.length > 15 ? d.name.slice(0, 15) + '...' : d.name)
      .attr('x', 14)
      .attr('y', 4)
      .attr('fill', '#9ca3af')
      .attr('font-size', '10px');

    node.on('click', async (_, d) => {
      try {
        const card = await fetchCard(d.id);
        onSelect(card);
      } catch {}
    });

    node.on('dblclick', (_, d) => loadGraph(d.id));

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
