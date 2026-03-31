import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Card, DeckEntry } from '../../types';
import { fetchDeckSynergies } from '../../lib/api';
import { renderAbility } from '../../lib/renderAbility';
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

// Role classification for deck analysis
const ROLE_MAP = {
  blockers: { label: 'Blockers', keywords: ['Blocker'], color: '#3b82f6' },
  removal: { label: 'Removal', keywords: ['KO', 'Bounce', 'Trash', 'Power Debuff', 'Rest'], color: '#ef4444' },
  draw_search: { label: 'Draw/Search', keywords: ['Draw', 'Search'], color: '#22c55e' },
  rush: { label: 'Rush', keywords: ['Rush'], color: '#f59e0b' },
  finishers: { label: 'Finishers', keywords: [] as string[], color: '#a855f7' },
  counter: { label: 'Counter', keywords: [] as string[], color: '#06b6d4' },
} as const;

type RoleKey = keyof typeof ROLE_MAP;
const ROLE_KEYS = Object.keys(ROLE_MAP) as RoleKey[];

function classifyRoles(node: { keywords: string[]; cost: number | null; power: number | null; counter: number | null }): RoleKey[] {
  const roles: RoleKey[] = [];
  const kws = node.keywords;
  for (const [key, def] of Object.entries(ROLE_MAP) as [RoleKey, (typeof ROLE_MAP)[RoleKey]][]) {
    if (def.keywords.length > 0 && kws.some((kw) => def.keywords.some((rk) => kw.includes(rk)))) {
      roles.push(key);
    }
  }
  if ((node.cost ?? 0) >= 7 && (node.power ?? 0) >= 7000) roles.push('finishers');
  if ((node.counter ?? 0) > 0) roles.push('counter');
  return [...new Set(roles)];
}

const EMPTY_ROLE_COUNTS: Record<RoleKey, number> = { blockers: 0, removal: 0, draw_search: 0, rush: 0, finishers: 0, counter: 0 };

interface MapNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  card_type: string;
  cost: number | null;
  power: number | null;
  counter: number | null;
  color: string;
  colors: string[];
  families: string[];
  keywords: string[];
  ability: string;
  image_small: string;
  rarity: string;
  market_price: number | null;
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

// Column layout helpers
const COL_LABELS = ['0-1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];

function getCostColIndex(cost: number | null): number {
  const c = cost ?? 0;
  if (c <= 1) return 0;
  if (c >= 10) return 9;
  return c - 1;
}

export default function DeckMap({ leader, entries, onCardSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(false);
  const [edges, setEdges] = useState<DeckSynergyEdge[]>([]);
  const [hoverCard, setHoverCard] = useState<{ node: MapNode; x: number; y: number; flipUp?: boolean } | null>(null);
  const [connCounts, setConnCounts] = useState<Map<string, number>>(new Map());
  const [showAllEdges, setShowAllEdges] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const highlightRef = useRef<((id: string | null) => void) | null>(null);

  // Role state
  const [activeRoles, setActiveRoles] = useState<Set<RoleKey>>(new Set());
  const [roleCounts, setRoleCounts] = useState<Record<RoleKey, number>>(EMPTY_ROLE_COUNTS);
  const [nodeRoleMap, setNodeRoleMap] = useState<Map<string, RoleKey[]>>(new Map());
  const roleDimRef = useRef<((roles: Set<RoleKey>) => void) | null>(null);

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

    function buildNode(card: Card, qty: number, isLeader: boolean): MapNode {
      const colors = card.colors?.length ? card.colors : card.color ? [card.color] : [];
      return {
        id: card.id,
        name: card.name,
        card_type: card.card_type,
        cost: card.cost,
        power: card.power ?? null,
        counter: card.counter ?? null,
        color: colors[0] || '',
        colors,
        families: card.families ?? [],
        keywords: card.keywords ?? [],
        ability: card.ability ?? '',
        image_small: card.image_small,
        rarity: card.rarity ?? '',
        market_price: card.market_price ?? null,
        quantity: qty,
        isLeader,
      };
    }

    if (leader) {
      nodes.push(buildNode(leader, 1, true));
    }

    for (const [, { card, quantity }] of entries) {
      if (leader && card.id === leader.id) continue;
      nodes.push(buildNode(card, quantity, false));
    }

    if (nodes.length === 0) return;

    // Classify roles
    const rMap = new Map<string, RoleKey[]>();
    const rCounts = { ...EMPTY_ROLE_COUNTS };
    for (const n of nodes) {
      const roles = classifyRoles(n);
      rMap.set(n.id, roles);
      for (const r of roles) rCounts[r] += n.quantity;
    }
    setNodeRoleMap(rMap);
    setRoleCounts(rCounts);

    // Build links (only between nodes that exist)
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: MapLink[] = edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => {
        let label = e.type.replace('_', ' ');
        if (e.shared_families?.length) label = e.shared_families.join(', ');
        else if (e.shared_keywords?.length) label = e.shared_keywords.join(', ');
        else if (e.cost_diff !== undefined) label = `Cost +${e.cost_diff}`;
        return { source: e.source, target: e.target, type: e.type, weight: e.weight, label };
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

    // Particle glow filter
    const particleGlow = defs.append('filter').attr('id', 'particle-glow');
    particleGlow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
    const pMerge = particleGlow.append('feMerge');
    pMerge.append('feMergeNode').attr('in', 'blur');
    pMerge.append('feMergeNode').attr('in', 'blur');
    pMerge.append('feMergeNode').attr('in', 'SourceGraphic');

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

    // ========== COLUMN GRID LAYOUT ==========
    const leaderAreaW = 90;
    const cardH = 56;
    const ySpacing = 72;
    const yHeaderH = 36;
    const yStart = 20;

    // Group cards by cost column
    const columns: MapNode[][] = Array.from({ length: 10 }, () => []);
    const leaderNode = nodes.find((n) => n.isLeader);

    for (const n of nodes) {
      if (n.isLeader) continue;
      columns[getCostColIndex(n.cost)].push(n);
    }

    // Sort within columns: by power descending
    for (const col of columns) {
      col.sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
    }

    // Non-empty columns
    const nonEmptyCols = columns.map((_, i) => i).filter((i) => columns[i].length > 0);
    const numCols = nonEmptyCols.length;
    const availableW = Math.max(400, width - leaderAreaW - 40);
    const colWidth = Math.max(58, Math.min(100, availableW / Math.max(numCols, 1)));

    // Leader position
    if (leaderNode) {
      const maxColHeight = Math.max(...columns.map((c) => c.length)) * ySpacing + yStart + yHeaderH;
      const leaderY = Math.max(height / 2, maxColHeight / 2);
      leaderNode.fx = leaderAreaW / 2;
      leaderNode.fy = leaderY;
      leaderNode.x = leaderNode.fx;
      leaderNode.y = leaderNode.fy;
    }

    // Place cards in columns
    for (let ci = 0; ci < nonEmptyCols.length; ci++) {
      const colIdx = nonEmptyCols[ci];
      const colX = leaderAreaW + 20 + ci * colWidth + colWidth / 2;
      const colNodes = columns[colIdx];
      for (let ri = 0; ri < colNodes.length; ri++) {
        const n = colNodes[ri];
        n.fx = colX;
        n.fy = yStart + yHeaderH + 30 + ri * ySpacing;
        n.x = n.fx;
        n.y = n.fy;
      }
    }

    // Draw column headers
    for (let ci = 0; ci < nonEmptyCols.length; ci++) {
      const colIdx = nonEmptyCols[ci];
      const colX = leaderAreaW + 20 + ci * colWidth + colWidth / 2;
      const colCount = columns[colIdx].length;
      const colH = colCount * ySpacing + yHeaderH + 20;

      // Column background stripe
      g.append('rect')
        .attr('x', colX - colWidth / 2 + 2)
        .attr('y', yStart)
        .attr('width', colWidth - 4)
        .attr('height', colH)
        .attr('rx', 6)
        .attr('fill', ci % 2 === 0 ? '#0f172a' : '#111827')
        .attr('opacity', 0.5);

      // Cost label
      g.append('text')
        .attr('x', colX)
        .attr('y', yStart + 16)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#64748b')
        .text(COL_LABELS[colIdx]);

      // Card count
      g.append('text')
        .attr('x', colX)
        .attr('y', yStart + 28)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#475569')
        .text(`(${colCount})`);
    }

    // Auto-fit zoom
    const allX = nodes.map((n) => n.fx ?? n.x ?? 0);
    const allY = nodes.map((n) => n.fy ?? n.y ?? 0);
    const minX = Math.min(...allX) - 50;
    const maxX = Math.max(...allX) + 50;
    const minY = Math.min(...allY) - 60;
    const maxY = Math.max(...allY) + cardH + 40;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const scale = Math.min(width / contentW, height / contentH, 1.2);
    const tx = (width - contentW * scale) / 2 - minX * scale;
    const ty = (height - contentH * scale) / 2 - minY * scale;

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => g.attr('transform', event.transform as unknown as string));

    svg.call(zoomBehavior);
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    // Gentle force simulation — nodes are pinned
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink<MapNode, MapLink>(links)
          .id((d) => d.id)
          .distance(100),
      )
      .alpha(0.05)
      .alphaDecay(0.1);

    // Draw edges
    const link = g
      .append('g')
      .selectAll<SVGLineElement, MapLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => EDGE_COLORS[d.type] ?? '#475569')
      .attr('stroke-width', (d) => Math.max(1, (d.weight ?? 1) * 0.8))
      .attr('stroke-opacity', 0)
      .style('transition', 'stroke-opacity 0.3s, stroke-width 0.3s');

    // Energy particle layer
    const particleLayer = g.append('g').attr('class', 'particles');

    function animateParticles(activeLinks: MapLink[]) {
      particleLayer.selectAll('*').remove();
      if (activeLinks.length === 0) return;

      for (const l of activeLinks) {
        const src = l.source as MapNode;
        const tgt = l.target as MapNode;
        if (src.x == null || tgt.x == null || src.y == null || tgt.y == null) continue;

        const color = EDGE_COLORS[l.type] ?? '#475569';
        for (let p = 0; p < 2; p++) {
          const particle = particleLayer
            .append('circle')
            .attr('r', 2.5)
            .attr('fill', color)
            .attr('opacity', 0.9)
            .attr('filter', 'url(#particle-glow)');

          const duration = 2000 + Math.random() * 1500;
          const delay = p * (duration / 2);

          function pulse() {
            particle
              .attr('cx', src.x!)
              .attr('cy', src.y!)
              .attr('opacity', 0)
              .transition()
              .delay(delay)
              .duration(200)
              .attr('opacity', 0.9)
              .attr('r', 3)
              .transition()
              .duration(duration)
              .ease(d3.easeCubicInOut)
              .attr('cx', tgt.x!)
              .attr('cy', tgt.y!)
              .attr('r', 1.5)
              .transition()
              .duration(200)
              .attr('opacity', 0)
              .on('end', pulse);
          }
          pulse();
        }
      }
    }

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
        d.image_small ? `url(#img-${d.id.replace(/[^a-zA-Z0-9]/g, '_')})` : COLOR_MAP[d.color] ?? '#374151',
      )
      .attr('stroke', (d) => {
        const conn = connectionCount.get(d.id) ?? 0;
        if (d.isLeader) return '#fbbf24';
        if (conn === 0) return '#ef4444';
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

    // Highlighting logic (click-to-show-connections)
    function highlight(nodeId: string | null) {
      if (!nodeId) {
        node.select('.card-rect').attr('opacity', 1).attr('filter', null);
        node.selectAll('text').attr('opacity', 1);
        link.attr('stroke-opacity', 0);
        linkLabel.attr('opacity', 0);
        animateParticles([]);
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
        d3.select(this).attr('opacity', src === nodeId || tgt === nodeId ? 1 : 0);
      });

      const activeLinks = links.filter((l) => {
        const src = typeof l.source === 'object' ? (l.source as MapNode).id : String(l.source);
        const tgt = typeof l.target === 'object' ? (l.target as MapNode).id : String(l.target);
        return src === nodeId || tgt === nodeId;
      });
      animateParticles(activeLinks);
    }

    highlightRef.current = highlight;

    // Role dim function
    function applyRoleDim(roles: Set<RoleKey>) {
      if (roles.size === 0) {
        node.select('.card-rect').attr('opacity', 1).attr('filter', null);
        node.selectAll('text').attr('opacity', 1);
        node.select('.role-border').remove();
        return;
      }

      node.each(function (d) {
        const el = d3.select(this);
        const nodeRoles = rMap.get(d.id) ?? [];
        const matches = d.isLeader || nodeRoles.some((r) => roles.has(r));

        el.select('.card-rect').attr('opacity', matches ? 1 : 0.15);
        el.selectAll('text').attr('opacity', matches ? 1 : 0.15);

        el.select('.role-border').remove();
        if (matches && !d.isLeader) {
          const matchingRole = nodeRoles.find((r) => roles.has(r));
          if (matchingRole) {
            const roleColor = ROLE_MAP[matchingRole].color;
            el.insert('rect', '.card-rect')
              .attr('class', 'role-border')
              .attr('width', 46)
              .attr('height', 62)
              .attr('x', -23)
              .attr('y', -31)
              .attr('rx', 6)
              .attr('fill', 'none')
              .attr('stroke', roleColor)
              .attr('stroke-width', 2.5)
              .attr('filter', 'url(#glow-map)');
          }
        }
      });
    }

    roleDimRef.current = applyRoleDim;

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
      const tooltipW = 320;
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const spaceBelow = rect.height - cursorY;
      const spaceRight = rect.width - cursorX;

      const txPos = spaceRight > tooltipW + 20 ? cursorX + 15 : Math.max(4, cursorX - tooltipW - 15);
      let tyPos: number;
      if (spaceBelow < 200) {
        tyPos = cursorY - 50;
      } else {
        tyPos = cursorY + 15;
      }
      if (tyPos < 4) tyPos = 4;

      setHoverCard({ node: d, x: txPos, y: tyPos, flipUp: spaceBelow < 200 });
    });

    node.on('mouseleave', () => {
      setHoverCard(null);
    });

    node.on('dblclick', (event, d) => {
      event.stopPropagation();
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

  // Apply role dim when activeRoles changes
  useEffect(() => {
    roleDimRef.current?.(activeRoles);
  }, [activeRoles]);

  // Toggle all edges on/off
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    if (showAllEdges) {
      svg
        .selectAll<SVGLineElement, MapLink>('line')
        .attr('stroke-opacity', 0.35)
        .attr('stroke-width', 1.5);
    } else {
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

  const toggleRole = (key: RoleKey) => {
    setActiveRoles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-gray-500">Connections</span>
            <button
              onClick={() => setShowAllEdges((prev) => !prev)}
              className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors ${showAllEdges ? 'bg-blue-600' : 'bg-gray-700'}`}
            >
              <span
                className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${showAllEdges ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
              />
            </button>
          </label>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: EDGE_COLORS.SYNERGY }} />
            <span className="text-gray-500">Family</span>
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-3 h-0.5 inline-block rounded"
              style={{ backgroundColor: EDGE_COLORS.MECHANICAL_SYNERGY }}
            />
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

      {/* Role Stats Bar */}
      <div className="shrink-0 bg-gray-900/80 border-b border-gray-800 px-4 py-1.5 flex items-center gap-2 text-xs overflow-x-auto">
        <span className="text-gray-600 text-[10px] uppercase tracking-wider mr-1 shrink-0">Roles</span>
        {ROLE_KEYS.map((key) => {
          const def = ROLE_MAP[key];
          const count = roleCounts[key];
          const isActive = activeRoles.has(key);
          const barW = Math.min(count / 16, 1) * 48;
          return (
            <button
              key={key}
              onClick={() => toggleRole(key)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded transition-all shrink-0 ${
                isActive ? 'bg-gray-700' : 'hover:bg-gray-800/60'
              }`}
              style={isActive ? { boxShadow: `0 0 0 1px ${def.color}` } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: def.color }}
              />
              <span className={`text-[11px] ${isActive ? 'text-white font-medium' : 'text-gray-400'}`}>
                {def.label}
              </span>
              <span className="text-[11px] font-mono text-gray-300 w-4 text-right">{count}</span>
              <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: barW, backgroundColor: def.color }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/50">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}

      {/* D3 SVG */}
      <svg ref={svgRef} className="flex-1 w-full bg-gray-950" />

      {/* Hover Tooltip */}
      {hoverCard &&
        (() => {
          const n = hoverCard.node;
          return (
            <div
              className="absolute z-20 pointer-events-none bg-gray-800/95 border border-gray-600 rounded-xl shadow-2xl p-4 w-80 backdrop-blur-sm"
              style={{
                left: hoverCard.x,
                top: hoverCard.y,
                transform: hoverCard.flipUp ? 'translateY(-100%)' : undefined,
              }}
            >
              <div className="flex gap-3">
                {n.image_small && (
                  <img src={n.image_small} alt="" className="w-24 h-[134px] rounded-lg object-cover shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-bold leading-tight">{n.name}</p>
                  <p className="text-gray-400 text-[11px] mt-0.5">
                    {n.id} &middot; {n.rarity} &middot; {n.card_type}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {n.cost !== null && (
                      <span className="bg-blue-900/60 text-blue-300 rounded px-1.5 py-0.5 text-[10px]">
                        Cost {n.cost}
                      </span>
                    )}
                    {n.power !== null && (
                      <span className="bg-red-900/60 text-red-300 rounded px-1.5 py-0.5 text-[10px]">
                        {n.power} PWR
                      </span>
                    )}
                    {n.counter !== null && n.counter > 0 && (
                      <span className="bg-green-900/60 text-green-300 rounded px-1.5 py-0.5 text-[10px]">
                        +{n.counter} CTR
                      </span>
                    )}
                    <span className="bg-gray-700 text-gray-300 rounded px-1.5 py-0.5 text-[10px]">{n.quantity}x</span>
                  </div>

                  {n.colors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {n.colors.map((c) => (
                        <span
                          key={c}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: (COLOR_MAP[c] ?? '#374151') + '30',
                            color: COLOR_MAP[c] ?? '#9ca3af',
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {n.families.length > 0 && (
                    <p className="text-gray-500 text-[10px] mt-1 truncate">{n.families.join(', ')}</p>
                  )}
                </div>
              </div>

              {n.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-700">
                  {n.keywords.map((kw) => (
                    <span key={kw} className="bg-purple-900/40 text-purple-300 rounded px-1.5 py-0.5 text-[10px]">
                      {kw}
                    </span>
                  ))}
                </div>
              )}

              {n.ability && (
                <div className="text-gray-400 text-[10px] mt-2 pt-2 border-t border-gray-700 leading-relaxed">
                  {renderAbility(n.ability, true)}
                </div>
              )}

              {/* Roles */}
              {(() => {
                const roles = nodeRoleMap.get(n.id) ?? [];
                return roles.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-700">
                    {roles.map((r) => (
                      <span
                        key={r}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: ROLE_MAP[r].color + '30', color: ROLE_MAP[r].color }}
                      >
                        {ROLE_MAP[r].label}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}

              <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-700 text-[10px]">
                <span className="text-gray-500">{connCounts.get(n.id) ?? 0} connections</span>
                {n.market_price !== null && <span className="text-green-400">${n.market_price.toFixed(2)}</span>}
              </div>
            </div>
          );
        })()}

      {/* Help text */}
      <div className="absolute bottom-3 left-3 text-[10px] text-gray-600 bg-gray-900/80 rounded px-2 py-1">
        Click card to highlight connections &middot; Click role to filter &middot; Double-click to view &middot; Scroll
        to zoom &middot; Drag to move
      </div>
    </div>
  );
}
