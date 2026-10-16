/**
 * The schema graph: the TWB ontology laid out by force, in WebVOWL's notation (`graph.ts`).
 * Drag a class, scroll to zoom, drag the background to pan, click a class for the side panel.
 * Lazy-loaded with the data model page's schema section; the layout runs only in the browser.
 *
 * Other parts of the page focus a class with `focusClass(id)`, which this listens for.
 */

import {
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
    type Simulation,
} from 'd3-force';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { fill, type Lang } from '../copy';
import { modelCopy } from './copy';
import {
    MODULE_COLOURS,
    graphModules,
    buildGraph,
    classDetail,
    data,
    id as idOf,
    labelOf,
    type GraphLink,
    type GraphNode,
    type ModuleId,
} from './graph';

export const FOCUS_EVENT = 'twb:focus-class';

/** A focus asked for before the graph mounted, taken up when it does. */
let pending: string | null = null;

/** Asks the schema graph to show and select a class (from the concept cards). */
export function focusClass(classId: string): void {
    pending = classId;
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: classId }));
}

const WIDTH = 1200;
const HEIGHT = 760;

interface View {
    x: number;
    y: number;
    k: number;
}

export default function SchemaGraph({ lang }: { lang: Lang }) {
    const c = modelCopy.schema;
    const [modules, setModules] = useState<Set<string>>(
        () => new Set(graphModules.map((m) => m.id))
    );
    const [external, setExternal] = useState(true);
    const [vocabularies, setVocabularies] = useState(false);
    const [allLabels, setAllLabels] = useState(false);
    const [selected, setSelected] = useState<string | null>(() => pending);
    const [hover, setHover] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
    const [, setFrame] = useState(0);

    const svg = useRef<SVGSVGElement>(null);
    const sim = useRef<Simulation<GraphNode, GraphLink> | null>(null);
    const positions = useRef(new Map<string, { x: number; y: number }>());

    const graph = useMemo(
        () => buildGraph({ modules, external, vocabularies }),
        [modules, external, vocabularies]
    );

    // The layout: each module pulled towards its own place on a ring, the borrowed classes in the
    // middle, so a module reads as a neighbourhood.
    useEffect(() => {
        const anchors = new Map<string, { x: number; y: number }>();
        graphModules.forEach((m, i) => {
            const a = (i / graphModules.length) * Math.PI * 2 - Math.PI / 2;
            anchors.set(m.id, {
                x: WIDTH / 2 + Math.cos(a) * 340,
                y: HEIGHT / 2 + Math.sin(a) * 220,
            });
        });
        const anchor = (n: GraphNode) =>
            n.module ? anchors.get(n.module)! : { x: WIDTH / 2, y: HEIGHT / 2 };
        for (const n of graph.nodes) {
            const kept = positions.current.get(n.id);
            const a = anchor(n);
            n.x = kept?.x ?? a.x + (Math.random() - 0.5) * 80;
            n.y = kept?.y ?? a.y + (Math.random() - 0.5) * 80;
        }
        const simulation = forceSimulation<GraphNode, GraphLink>(graph.nodes)
            .force(
                'link',
                forceLink<GraphNode, GraphLink>(graph.links)
                    .id((n) => n.id)
                    .distance((l) => (l.kind === 'subclass' ? 64 : 120))
                    .strength((l) => (l.kind === 'subclass' ? 0.5 : 0.08))
            )
            .force('charge', forceManyBody<GraphNode>().strength(-260).distanceMax(420))
            .force(
                'collide',
                forceCollide<GraphNode>().radius((n) => n.r + 8)
            )
            .force('x', forceX<GraphNode>((n) => anchor(n).x).strength(0.07))
            .force('y', forceY<GraphNode>((n) => anchor(n).y).strength(0.09))
            .stop();
        const fresh = graph.nodes.some((n) => !positions.current.has(n.id));
        simulation.tick(fresh ? 260 : 40);
        simulation.alpha(0.05).on('tick', () => {
            for (const n of graph.nodes) positions.current.set(n.id, { x: n.x!, y: n.y! });
            setFrame((f) => f + 1);
        });
        for (const n of graph.nodes) positions.current.set(n.id, { x: n.x!, y: n.y! });
        sim.current = simulation;
        setFrame((f) => f + 1);
        if (fresh) setView(fitView(graph.nodes));
        simulation.restart();
        return () => {
            simulation.stop();
        };
    }, [graph]);

    // Focus requests from the rest of the page.
    useEffect(() => {
        const on = (e: Event) => {
            const id = (e as CustomEvent<string>).detail;
            const cls = data.classes.find((k) => k.id === id);
            if (cls && !modules.has(cls.module)) setModules((m) => new Set([...m, cls.module]));
            if (cls?.superClasses.includes('skos:Concept')) setVocabularies(true);
            setSelected(id);
            pending = null;
        };
        window.addEventListener(FOCUS_EVENT, on);
        return () => window.removeEventListener(FOCUS_EVENT, on);
    }, [modules]);

    // Centre the selected class once it is on screen.
    useEffect(() => {
        if (!selected) return;
        const n = graph.nodes.find((k) => k.id === selected);
        if (!n || n.x === undefined) return;
        setView((v) => {
            const k = Math.max(v.k, 1.1);
            return { k, x: WIDTH / 2 - n.x! * k, y: HEIGHT / 2 - n.y! * k };
        });
    }, [selected, graph]);

    // ── Zoom and pan ──────────────────────────────────────────────────────────────────────

    const toModel = useCallback(
        (clientX: number, clientY: number) => {
            const rect = svg.current!.getBoundingClientRect();
            const sx = ((clientX - rect.left) / rect.width) * WIDTH;
            const sy = ((clientY - rect.top) / rect.height) * HEIGHT;
            return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
        },
        [view]
    );

    useEffect(() => {
        const el = svg.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const sx = ((e.clientX - rect.left) / rect.width) * WIDTH;
            const sy = ((e.clientY - rect.top) / rect.height) * HEIGHT;
            setView((v) => {
                const k = Math.min(3, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
                return { k, x: sx - ((sx - v.x) / v.k) * k, y: sy - ((sy - v.y) / v.k) * k };
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const drag = useRef<
        | { kind: 'pan'; sx: number; sy: number; view: View; moved: boolean }
        | { kind: 'node'; node: GraphNode; moved: boolean }
        | null
    >(null);

    const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
        if (e.button !== 0) return;
        const p = toModel(e.clientX, e.clientY);
        drag.current = { kind: 'pan', sx: p.sx, sy: p.sy, view, moved: false };
        svg.current?.setPointerCapture(e.pointerId);
    };

    const onNodeDown = (e: ReactPointerEvent, node: GraphNode) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        drag.current = { kind: 'node', node, moved: false };
        svg.current?.setPointerCapture(e.pointerId);
    };

    const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
        const d = drag.current;
        if (!d) return;
        const p = toModel(e.clientX, e.clientY);
        if (d.kind === 'pan') {
            if (Math.hypot(p.sx - d.sx, p.sy - d.sy) > 3) d.moved = true;
            setView({ ...d.view, x: d.view.x + p.sx - d.sx, y: d.view.y + p.sy - d.sy });
        } else {
            d.moved = true;
            d.node.fx = p.x;
            d.node.fy = p.y;
            sim.current?.alphaTarget(0.25).restart();
        }
    };

    const onUp = () => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.kind === 'node') {
            d.node.fx = null;
            d.node.fy = null;
            sim.current?.alphaTarget(0);
            if (!d.moved) setSelected((s) => (s === d.node.id ? null : d.node.id));
        } else if (!d.moved) {
            setSelected(null);
        }
    };

    // ── What is lit ───────────────────────────────────────────────────────────────────────

    const focus = hover ?? selected;
    const neighbours = useMemo(() => {
        if (!focus) return null;
        const s = new Set([focus]);
        for (const l of graph.links) {
            if (idOf(l.source) === focus) s.add(idOf(l.target));
            if (idOf(l.target) === focus) s.add(idOf(l.source));
        }
        return s;
    }, [focus, graph]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];
        return graph.nodes
            .filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
            .slice(0, 8);
    }, [query, graph]);

    const toggleModule = (m: string) =>
        setModules((s) => {
            const next = new Set(s);
            if (next.has(m) && next.size > 1) next.delete(m);
            else next.add(m);
            return next;
        });

    const soloModule = (m: string) => setModules(new Set([m]));

    return (
        <div className="schema">
            <div className="schema-controls">
                <div className="schema-search">
                    <input
                        type="search"
                        value={query}
                        placeholder={c.search[lang]}
                        aria-label={c.search[lang]}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {matches.length > 0 && (
                        <ul className="schema-matches">
                            {matches.map((n) => (
                                <li key={n.id}>
                                    <button
                                        onClick={() => {
                                            setSelected(n.id);
                                            setQuery('');
                                        }}
                                    >
                                        {n.label} <span className="muted">{n.id}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="chips" role="group" aria-label={c.modules[lang]}>
                    <button
                        className={modules.size === graphModules.length ? 'chip is-on' : 'chip'}
                        onClick={() => setModules(new Set(graphModules.map((m) => m.id)))}
                    >
                        {c.allModules[lang]}
                    </button>
                    {graphModules.map((m) => (
                        <button
                            key={m.id}
                            className={modules.has(m.id) ? 'chip is-on' : 'chip'}
                            aria-pressed={modules.has(m.id)}
                            onClick={() => toggleModule(m.id)}
                            onDoubleClick={() => soloModule(m.id)}
                        >
                            <span
                                className="module-dot"
                                style={{ background: MODULE_COLOURS[m.id] }}
                            />
                            {m.label[lang]}
                        </button>
                    ))}
                </div>
                <div className="schema-toggles">
                    <label>
                        <input
                            type="checkbox"
                            checked={external}
                            onChange={(e) => setExternal(e.target.checked)}
                        />
                        {c.external[lang]}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={vocabularies}
                            onChange={(e) => setVocabularies(e.target.checked)}
                        />
                        {c.vocabularies[lang]}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={allLabels}
                            onChange={(e) => setAllLabels(e.target.checked)}
                        />
                        {c.labels[lang]}
                    </label>
                    <button className="chip" onClick={() => setView(fitView(graph.nodes))}>
                        {c.fit[lang]}
                    </button>
                </div>
            </div>
            <div className="schema-body">
                <svg
                    ref={svg}
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="schema-svg"
                    role="img"
                    aria-label={c.title[lang]}
                    onPointerDown={onBackgroundDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                >
                    <defs>
                        <marker
                            id="vowl-arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="7"
                            markerHeight="7"
                            orient="auto"
                        >
                            <path d="M0,0 L10,5 L0,10 z" className="vowl-arrowhead" />
                        </marker>
                        <marker
                            id="vowl-sub"
                            viewBox="0 0 12 12"
                            refX="11"
                            refY="6"
                            markerWidth="9"
                            markerHeight="9"
                            orient="auto"
                        >
                            <path d="M1,1 L11,6 L1,11 z" className="vowl-subhead" />
                        </marker>
                    </defs>
                    <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                        {graph.links.map((l) => (
                            <Link
                                key={l.id}
                                link={l}
                                dim={
                                    !!neighbours &&
                                    !(
                                        neighbours.has(idOf(l.source)) &&
                                        neighbours.has(idOf(l.target)) &&
                                        (idOf(l.source) === focus || idOf(l.target) === focus)
                                    )
                                }
                                showLabel={
                                    l.kind === 'property' &&
                                    (allLabels ||
                                        (!!focus &&
                                            (idOf(l.source) === focus || idOf(l.target) === focus)))
                                }
                            />
                        ))}
                        {graph.nodes.map((n) => (
                            <Node
                                key={n.id}
                                node={n}
                                selected={n.id === selected}
                                dim={!!neighbours && !neighbours.has(n.id)}
                                onPointerDown={(e) => onNodeDown(e, n)}
                                onEnter={() => setHover(n.id)}
                                onLeave={() => setHover((h) => (h === n.id ? null : h))}
                            />
                        ))}
                    </g>
                </svg>
                <Panel
                    lang={lang}
                    classId={selected}
                    onPick={setSelected}
                    onClose={() => setSelected(null)}
                />
            </div>
            <div className="schema-foot">
                <ul className="vowl-legend">
                    <li>
                        <svg viewBox="0 0 24 24" aria-hidden>
                            <circle
                                cx="12"
                                cy="12"
                                r="9"
                                className="vowl-class"
                                style={{ fill: '#dcebfa', stroke: '#2a78d6' }}
                            />
                        </svg>
                        {c.legend.cls[lang]}
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" aria-hidden>
                            <circle cx="12" cy="12" r="9" className="vowl-external" />
                        </svg>
                        {c.legend.external[lang]}
                    </li>
                    <li>
                        <svg viewBox="0 0 40 12" aria-hidden className="wide">
                            <line
                                x1="2"
                                y1="6"
                                x2="34"
                                y2="6"
                                className="vowl-link"
                                markerEnd="url(#vowl-arrow)"
                            />
                        </svg>
                        {c.legend.property[lang]}
                    </li>
                    <li>
                        <svg viewBox="0 0 40 12" aria-hidden className="wide">
                            <line
                                x1="2"
                                y1="6"
                                x2="32"
                                y2="6"
                                className="vowl-link is-subclass"
                                markerEnd="url(#vowl-sub)"
                            />
                        </svg>
                        {c.legend.subclass[lang]}
                    </li>
                </ul>
                <p className="fine">{c.hint[lang]}</p>
            </div>
        </div>
    );
}

function fitView(nodes: GraphNode[]): View {
    if (nodes.length === 0) return { x: 0, y: 0, k: 1 };
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const pad = 60;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const k = Math.min(2, WIDTH / (maxX - minX), HEIGHT / (maxY - minY));
    return { k, x: (WIDTH - (maxX + minX) * k) / 2, y: (HEIGHT - (maxY + minY) * k) / 2 };
}

/** A label in at most two lines that fit the circle. */
function wrap(label: string, max: number): string[] {
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
        if (line && (line + ' ' + w).length > max) {
            lines.push(line);
            line = w;
        } else {
            line = line ? `${line} ${w}` : w;
        }
    }
    if (line) lines.push(line);
    if (lines.length > 2)
        return [
            lines[0]!,
            `${lines
                .slice(1)
                .join(' ')
                .slice(0, max - 1)}…`,
        ];
    return lines;
}

function Node({
    node,
    selected,
    dim,
    onPointerDown,
    onEnter,
    onLeave,
}: {
    node: GraphNode;
    selected: boolean;
    dim: boolean;
    onPointerDown: (e: ReactPointerEvent) => void;
    onEnter: () => void;
    onLeave: () => void;
}) {
    const colour = node.module ? MODULE_COLOURS[node.module as ModuleId] : undefined;
    const lines = wrap(node.label, Math.max(8, Math.floor(node.r / 3.2)));
    return (
        <g
            className={`vowl-node${dim ? ' is-dim' : ''}${selected ? ' is-selected' : ''}`}
            transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
            onPointerDown={onPointerDown}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
        >
            <circle
                r={node.r}
                className={node.external ? 'vowl-external' : 'vowl-class'}
                style={
                    colour
                        ? { fill: `color-mix(in srgb, ${colour} 16%, #fff)`, stroke: colour }
                        : undefined
                }
            />
            {lines.map((line, i) => (
                <text
                    key={i}
                    y={(i - (lines.length - 1) / 2) * 13}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={node.external ? 'vowl-label is-external' : 'vowl-label'}
                >
                    {line}
                </text>
            ))}
        </g>
    );
}

function Link({ link, dim, showLabel }: { link: GraphLink; dim: boolean; showLabel: boolean }) {
    const s = link.source as GraphNode;
    const t = link.target as GraphNode;
    if (s.x === undefined || t.x === undefined) return null;
    const subclass = link.kind === 'subclass';
    let d: string;
    let mid: { x: number; y: number };
    if (s.id === t.id) {
        // A property from a class to itself: a loop over the circle.
        const r = s.r;
        const spread = 0.5 + link.lane * 0.35;
        const a1 = -Math.PI / 2 - spread;
        const a2 = -Math.PI / 2 + spread;
        const p1 = { x: s.x + Math.cos(a1) * r, y: s.y! + Math.sin(a1) * r };
        const p2 = { x: s.x + Math.cos(a2) * r, y: s.y! + Math.sin(a2) * r };
        const h = r + 46 + link.lane * 22;
        d = `M${p1.x},${p1.y} C${p1.x - 30},${s.y! - h} ${p2.x + 30},${s.y! - h} ${p2.x},${p2.y}`;
        mid = { x: s.x, y: s.y! - h * 0.78 };
    } else {
        const dx = t.x - s.x;
        const dy = t.y! - s.y!;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        // Lanes fan out on one side of the line between the pair, whichever way each link runs.
        const flip = s.id < t.id ? 1 : -1;
        const offset = (link.lane - (link.lanes - 1) / 2) * 34 * flip;
        const c = { x: (s.x + t.x) / 2 + nx * offset, y: (s.y! + t.y!) / 2 + ny * offset };
        const from = towards(s, c, s.r);
        const to = towards(t, c, t.r + 2);
        d = `M${from.x},${from.y} Q${c.x},${c.y} ${to.x},${to.y}`;
        mid = {
            x: 0.25 * from.x + 0.5 * c.x + 0.25 * to.x,
            y: 0.25 * from.y + 0.5 * c.y + 0.25 * to.y,
        };
    }
    const w = link.label.length * 6.2 + 12;
    return (
        <g className={`vowl-edge${dim ? ' is-dim' : ''}`}>
            <path
                d={d}
                className={subclass ? 'vowl-link is-subclass' : 'vowl-link'}
                markerEnd={subclass ? 'url(#vowl-sub)' : 'url(#vowl-arrow)'}
            />
            {showLabel && (
                <g transform={`translate(${mid.x} ${mid.y})`}>
                    <rect
                        x={-w / 2}
                        y={-9}
                        width={w}
                        height={18}
                        rx={3}
                        className="vowl-property"
                    />
                    <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="vowl-property-label"
                    >
                        {link.label}
                    </text>
                </g>
            )}
        </g>
    );
}

/** The point on a node's circle in the direction of `p`. */
function towards(n: GraphNode, p: { x: number; y: number }, r: number) {
    const dx = p.x - n.x!;
    const dy = p.y - n.y!;
    const len = Math.hypot(dx, dy) || 1;
    return { x: n.x! + (dx / len) * r, y: n.y! + (dy / len) * r };
}

function Panel({
    lang,
    classId,
    onPick,
    onClose,
}: {
    lang: Lang;
    classId: string | null;
    onPick: (id: string) => void;
    onClose: () => void;
}) {
    const p = modelCopy.schema.panel;
    if (!classId) {
        return (
            <aside className="schema-panel is-empty">
                <p>{p.empty[lang]}</p>
                <p className="fine">
                    TWB {data.version} · {data.classes.length} · {data.objectProperties.length} ·{' '}
                    {data.datatypeProperties.length}
                </p>
            </aside>
        );
    }
    const d = classDetail(classId);
    const module = d.cls ? data.modules.find((m) => m.id === d.cls!.module) : null;
    const ClassLink = ({ id }: { id: string }) => (
        <button className="term" onClick={() => onPick(id)} title={id}>
            {labelOf(id)}
        </button>
    );
    // Read the way the triple runs: out, this class → property → range; in, domain → property → this.
    const Property = ({
        prop,
        other,
        incoming,
    }: {
        prop: (typeof d.outgoing)[number];
        other: string[];
        incoming?: boolean;
    }) => (
        <li>
            {incoming && other.map((o) => <ClassLink key={o} id={o} />)}
            {incoming && ' → '}
            <code>{prop.id}</code>
            {!incoming && other.length > 0 && (
                <>
                    {' → '}
                    {other.map((o) => (
                        <ClassLink key={o} id={o} />
                    ))}
                </>
            )}
            {prop.functional && <span className="muted"> · {p.functional[lang]}</span>}
        </li>
    );
    return (
        <aside className="schema-panel" aria-live="polite">
            <header>
                <div>
                    {module && (
                        <p className="schema-module">
                            <span
                                className="module-dot"
                                style={{ background: MODULE_COLOURS[module.id] }}
                            />
                            {module.label[lang]}
                        </p>
                    )}
                    <h3>{d.cls?.label ?? classId}</h3>
                    <code className="schema-iri">{classId}</code>
                </div>
                <button className="ifc-close" onClick={onClose}>
                    {p.close[lang]}
                </button>
            </header>
            {d.cls?.comment && <p className="schema-comment">{d.cls.comment}</p>}
            {d.external && <p className="schema-comment">{p.external[lang]}</p>}
            <dl className="schema-facts">
                {d.superClasses.length > 0 && (
                    <div>
                        <dt>{p.superClasses[lang]}</dt>
                        <dd>
                            {d.superClasses.map((s) => (
                                <ClassLink key={s} id={s} />
                            ))}
                        </dd>
                    </div>
                )}
                {d.subClasses.length > 0 && (
                    <div>
                        <dt>{p.subClasses[lang]}</dt>
                        <dd>
                            {d.subClasses.map((s) => (
                                <ClassLink key={s} id={s} />
                            ))}
                        </dd>
                    </div>
                )}
                {d.cls && (
                    <div>
                        <dt>{p.instances[lang]}</dt>
                        <dd>
                            {d.instances > 0
                                ? fill(p.instancesN[lang], { n: String(d.instances) })
                                : p.noInstances[lang]}
                        </dd>
                    </div>
                )}
                {d.cls?.archTerm && (
                    <div>
                        <dt>{p.archTerm[lang]}</dt>
                        <dd>
                            <code>{d.cls.archTerm}</code>
                        </dd>
                    </div>
                )}
                {d.cls?.ifc && (
                    <div>
                        <dt>{p.ifc[lang]}</dt>
                        <dd>{d.cls.ifc}</dd>
                    </div>
                )}
            </dl>
            {d.outgoing.length > 0 && (
                <section>
                    <h4>{p.outgoing[lang]}</h4>
                    <ul className="schema-props">
                        {d.outgoing.map((prop) => (
                            <Property key={prop.id} prop={prop} other={prop.range} />
                        ))}
                    </ul>
                </section>
            )}
            {d.incoming.length > 0 && (
                <section>
                    <h4>{p.incoming[lang]}</h4>
                    <ul className="schema-props">
                        {d.incoming.map((prop) => (
                            <Property key={prop.id} prop={prop} other={prop.domain} incoming />
                        ))}
                    </ul>
                </section>
            )}
            {d.attributes.length > 0 && (
                <section>
                    <h4>{p.attributes[lang]}</h4>
                    <ul className="schema-props">
                        {d.attributes.map((prop) => (
                            <li key={prop.id}>
                                <code>{prop.id}</code>
                                <span className="muted"> : {prop.range.join(', ') || '—'}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </aside>
    );
}
