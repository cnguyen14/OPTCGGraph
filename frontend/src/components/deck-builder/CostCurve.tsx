import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface Props {
  curve: Record<number, number>;
}

export default function CostCurve({ curve }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 8, right: 4, bottom: 20, left: 20 };
    const width = svgRef.current.clientWidth - margin.left - margin.right;
    const height = 100 - margin.top - margin.bottom;

    const data = Array.from({ length: 11 }, (_, i) => ({
      cost: i,
      count: curve[i] || 0,
    }));

    const maxCount = Math.max(1, ...data.map((d) => d.count));

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<number>()
      .domain(data.map((d) => d.cost))
      .range([0, width])
      .padding(0.25);

    const y = d3.scaleLinear().domain([0, maxCount]).range([height, 0]);

    // Bars
    g.selectAll('rect')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.cost)!)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - y(d.count))
      .attr('rx', 2)
      .attr('fill', '#3b82f6')
      .attr('opacity', (d) => (d.count > 0 ? 0.85 : 0.15));

    // Count labels on bars
    g.selectAll('.count-label')
      .data(data.filter((d) => d.count > 0))
      .enter()
      .append('text')
      .attr('x', (d) => x(d.cost)! + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#93c5fd')
      .attr('font-size', '9px')
      .text((d) => d.count);

    // X axis labels
    g.selectAll('.x-label')
      .data(data)
      .enter()
      .append('text')
      .attr('x', (d) => x(d.cost)! + x.bandwidth() / 2)
      .attr('y', height + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b7280')
      .attr('font-size', '10px')
      .text((d) => (d.cost === 10 ? '10+' : d.cost));
  }, [curve]);

  return (
    <div className="bg-gray-800/50 rounded-lg p-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 px-1">Cost Curve</p>
      <svg ref={svgRef} className="w-full" style={{ height: 100 }} />
    </div>
  );
}
