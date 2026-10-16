/**
 * The data model page, `/datamodel/` and `/en/datamodel/`: the TWB ontology explained in five
 * concepts, the whole schema as a graph to pull at, parts of the case house in the open viewer
 * beside the graph their file makes, and the rules run on the case house in the browser.
 *
 * The text renders on the server with the rest of the site; the schema graph, the examples and
 * the checks are lazy and mount only in the browser, so the landing page carries none of them.
 */

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BASE, num, type Lang } from '../copy';
import { modelCopy } from './copy';
import ontology from '../data/ontology.json';
import { MODULE_COLOURS, TWB_MODULES, moduleIri } from './modules';



const SchemaGraph = lazy(() => import('./SchemaGraph'));
const Examples = lazy(() => import('./Examples').then((m) => ({ default: m.Examples })));
const Checks = lazy(() => import('./Checks').then((m) => ({ default: m.Checks })));

/** The counts the hero states, from `twb.ttl` and its modules (`scripts/capture-ontology.mjs`). */
export const ONTOLOGY_COUNTS = {
    classes: ontology.classes.length,
    objectProperties: ontology.objectProperties.length,
    datatypeProperties: ontology.datatypeProperties.length,
    version: ontology.version,
};

function useMounted(): boolean {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    return mounted;
}

function Part({
    id,
    kicker,
    title,
    lead,
    children,
    tint,
}: {
    id: string;
    kicker: string;
    title: string;
    lead?: string;
    children?: ReactNode;
    tint?: boolean;
}) {
    return (
        <section id={id} className={`section${tint ? ' section-tint' : ''}`}>
            <div className="wrap">
                <header className="section-head">
                    <p className="kicker">{kicker}</p>
                    <h2>{title}</h2>
                    {lead && <p className="lead">{lead}</p>}
                </header>
                {children}
            </div>
        </section>
    );
}

/**
 * A link from the landing page to a section (`/datamodel/#regeltjek`) arrives before the lazy
 * parts above it have mounted and grown, so the browser's own jump lands short: jump again once
 * they have.
 */
function useHashScroll(): void {
    useEffect(() => {
        const target = () =>
            location.hash ? document.getElementById(location.hash.slice(1)) : null;
        if (!target()) return;
        const jump = () => target()?.scrollIntoView({ block: 'start' });
        const timers = [50, 600, 1500].map((ms) => window.setTimeout(jump, ms));
        // Stop following once the reader scrolls themselves.
        const stop = () => timers.forEach((t) => window.clearTimeout(t));
        window.addEventListener('wheel', stop, { once: true, passive: true });
        window.addEventListener('touchstart', stop, { once: true, passive: true });
        return () => {
            stop();
            window.removeEventListener('wheel', stop);
            window.removeEventListener('touchstart', stop);
        };
    }, []);
}

export function DataModelPage({ lang }: { lang: Lang }) {
    const mounted = useMounted();
    useHashScroll();
    const h = modelCopy.hero;
    const k = modelCopy.concepts;
    const s = modelCopy.schema;
    const e = modelCopy.examples;
    const c = modelCopy.checks;
    const o = modelCopy.open;
    const md = modelCopy.modules;
    const focus = async (term: string) => {
        document.getElementById('skema')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const { focusClass } = await import('./SchemaGraph');
        focusClass(term);
    };
    return (
        <>
            <section className="dm-hero">
                <div className="wrap">
                    <p className="kicker">{h.kicker[lang]}</p>
                    <h1>
                        {h.title[lang].split('\n').map((line) => (
                            <span key={line}>{line}</span>
                        ))}
                    </h1>
                    <p className="lead">{h.lead[lang]}</p>
                    <dl className="dm-stats">
                        <div>
                            <dd>{num(ONTOLOGY_COUNTS.classes, lang)}</dd>
                            <dt>{h.stats.classes[lang]}</dt>
                        </div>
                        <div>
                            <dd>{num(ONTOLOGY_COUNTS.objectProperties, lang)}</dd>
                            <dt>{h.stats.objectProperties[lang]}</dt>
                        </div>
                        <div>
                            <dd>{num(ONTOLOGY_COUNTS.datatypeProperties, lang)}</dd>
                            <dt>{h.stats.datatypeProperties[lang]}</dt>
                        </div>
                        <div>
                            <dd>CC BY 4.0</dd>
                            <dt>{h.stats.licence[lang]}</dt>
                        </div>
                    </dl>
                    <p className="dm-downloads">
                        <a href={`${BASE}ontology/twb.ttl`} download className="link-arrow">
                            {h.downloads[lang]} <code>twb.ttl</code>
                        </a>
                        <a href={`${BASE}ontology/twb-shapes.ttl`} download className="link-arrow">
                            {h.shapes[lang]} <code>twb-shapes.ttl</code>
                        </a>
                        <a href={`${BASE}context/2.jsonld`} className="link-arrow is-go">
                            {h.context[lang]} <code>2.jsonld</code>
                        </a>
                        <a href={`${BASE}reference/`} className="link-arrow is-go">
                            Every class and property
                        </a>
                        <a href={`${BASE}validate/`} className="link-arrow is-go">
                            Validate a model
                        </a>
                    </p>
                </div>
            </section>

            <Part id="begreber" kicker={k.kicker[lang]} title={k.title[lang]} lead={k.lead[lang]}>
                <ol className="concepts">
                    {k.items.map((item, i) => (
                        <li key={item.term} className="concept">
                            <span className="card-index">{String(i + 1).padStart(2, '0')}</span>
                            <ConceptFigure index={i} />
                            <h3>{item.title[lang]}</h3>
                            <p>{item.body[lang]}</p>
                            <p className="concept-terms">
                                {item.terms.map((term) => (
                                    <button
                                        key={term}
                                        className="term"
                                        onClick={() => void focus(term)}
                                        title={k.showInSchema[lang]}
                                    >
                                        {term}
                                    </button>
                                ))}
                            </p>
                        </li>
                    ))}
                    <li className="concept is-derived">
                        <span className="card-index">→</span>
                        <h3>{k.derivedTitle[lang]}</h3>
                        <p>{k.derived[lang]}</p>
                        <p className="concept-terms">
                            {['twb:Derivation', 'twb:Member'].map((term) => (
                                <button
                                    key={term}
                                    className="term"
                                    onClick={() => void focus(term)}
                                    title={k.showInSchema[lang]}
                                >
                                    {term}
                                </button>
                            ))}
                        </p>
                    </li>
                </ol>
            </Part>

            <Part
                id="vaeglinjen"
                kicker={modelCopy.wallLine.kicker[lang]}
                title={modelCopy.wallLine.title[lang]}
                lead={modelCopy.wallLine.lead[lang]}
                tint
            >
                <WallLine lang={lang} />
            </Part>

            <Part id="moduler" kicker={md.kicker[lang]} title={md.title[lang]} lead={md.lead[lang]}>
                <Modules lang={lang} />
            </Part>

            <Part id="skema" kicker={s.kicker[lang]} title={s.title[lang]} lead={s.lead[lang]} tint>
                {mounted ? (
                    <Suspense fallback={<div className="schema-wait">{s.loading[lang]}</div>}>
                        <SchemaGraph lang={lang} />
                    </Suspense>
                ) : (
                    <div className="schema-wait">{s.noscript[lang]}</div>
                )}
            </Part>

            <Part id="eksempler" kicker={e.kicker[lang]} title={e.title[lang]} lead={e.lead[lang]}>
                {mounted && (
                    <Suspense fallback={<div className="schema-wait">{e.loading[lang]}</div>}>
                        <Examples lang={lang} />
                    </Suspense>
                )}
            </Part>

            <Part
                id="regeltjek"
                kicker={c.kicker[lang]}
                title={c.title[lang]}
                lead={c.lead[lang]}
                tint
            >
                {mounted && (
                    <Suspense fallback={<div className="schema-wait">{c.loading[lang]}</div>}>
                        <Checks lang={lang} />
                    </Suspense>
                )}
            </Part>

            <Part id="aabent" kicker={o.kicker[lang]} title={o.title[lang]} lead={o.lead[lang]}>
                <div className="open-split">
                    <div>
                        <h3>{o.openTitle[lang]}</h3>
                        <ul className="includes">
                            {o.openItems.map((t) => (
                                <li key={t.en}>{t[lang]}</li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3>{o.closedTitle[lang]}</h3>
                        <ul className="includes is-closed">
                            {o.closedItems.map((t) => (
                                <li key={t.en}>{t[lang]}</li>
                            ))}
                        </ul>
                    </div>
                </div>
                <h3 className="decisions-head">{o.decisionsTitle[lang]}</h3>
                <div className="faq">
                    {o.decisions.map((d) => (
                        <details key={d.q.en}>
                            <summary>{d.q[lang]}</summary>
                            <p>{d.a[lang]}</p>
                        </details>
                    ))}
                </div>
                <p className="aside">{o.paper[lang]}</p>
            </Part>
        </>
    );
}

/** One layer of a wall section as the figure draws it: its material's class and its width, mm. */
interface FigureLayer {
    kind: 'board' | 'stud' | 'wool' | 'block' | 'brick' | 'air';
    mm: number;
}

/** The two walls the wall line is shown in, inside → outside, and which layer carries. */
const WALL_FIGURES: Readonly<
    Record<'timber' | 'masonry', { layers: FigureLayer[]; core: number }>
> = {
    timber: {
        layers: [
            { kind: 'board', mm: 26 },
            { kind: 'wool', mm: 45 },
            { kind: 'stud', mm: 195 },
            { kind: 'board', mm: 12 },
            { kind: 'air', mm: 25 },
            { kind: 'board', mm: 47 },
        ],
        core: 2,
    },
    masonry: {
        layers: [
            { kind: 'block', mm: 100 },
            { kind: 'wool', mm: 196 },
            { kind: 'brick', mm: 108 },
        ],
        core: 0,
    },
};

/**
 * A plan section through one wall, inside on the left: its layers to scale, and the wall line
 * dashed through the middle of the layer that carries — where TWB's thin surface lies.
 */
function WallSection({ which, lang }: { which: 'timber' | 'masonry'; lang: Lang }) {
    const { layers, core } = WALL_FIGURES[which];
    const f = modelCopy.wallLine.figure;
    const scale = 0.5;
    const pad = 28;
    const height = 120;
    let x = pad;
    const rects = layers.map((l) => {
        const r = { ...l, x, w: l.mm * scale };
        x += r.w;
        return r;
    });
    const width = x + pad;
    const c = rects[core]!;
    const lineX = c.x + c.w / 2;
    return (
        <svg
            className="wall-section"
            viewBox={`0 0 ${width} ${height + 44}`}
            role="img"
            aria-label={modelCopy.wallLine[which].title[lang]}
        >
            {rects.map((r, i) => (
                <rect
                    key={i}
                    className={`ws-${r.kind}`}
                    x={r.x}
                    y={16}
                    width={r.w}
                    height={height}
                />
            ))}
            <line className="ws-line" x1={lineX} x2={lineX} y1={4} y2={height + 28} />
            <text className="ws-label" x={lineX} y={height + 42} textAnchor="middle">
                {f.line[lang]}
            </text>
            <text className="ws-side" x={4} y={12}>
                {f.inside[lang]}
            </text>
            <text className="ws-side" x={width - 4} y={12} textAnchor="end">
                {f.outside[lang]}
            </text>
        </svg>
    );
}

/** Where the thin wall lies, in a timber wall and in a cavity wall, side by side. */
function WallLine({ lang }: { lang: Lang }) {
    const w = modelCopy.wallLine;
    return (
        <>
            <div className="open-split wall-line">
                {(['timber', 'masonry'] as const).map((which) => (
                    <div key={which}>
                        <WallSection which={which} lang={lang} />
                        <h3>{w[which].title[lang]}</h3>
                        <p>{w[which].body[lang]}</p>
                    </div>
                ))}
            </div>
            <p className="aside">{w.rule[lang]}</p>
        </>
    );
}

/**
 * TWB's modules: the umbrella over them, one row per module with its IRI, what it imports and
 * defines, and its file; then the companions beside them. Each is the anchor (`#modul-core`,
 * `#modul-shapes`) w3id sends a browser to for that module's IRI.
 */
function Modules({ lang }: { lang: Lang }) {
    const md = modelCopy.modules;
    const name = (id: string) => md.names[id]![lang];
    return (
        <>
            <div className="module-umbrella">
                <a href="https://w3id.org/twb" className="module-iri">
                    https://w3id.org/twb
                </a>
                <span>owl:imports</span>
                <span className="module-umbrella-list">
                    {TWB_MODULES.map((m) => m.id).join(' · ')}
                </span>
                <a href={`${BASE}ontology/twb.ttl`} download className="link-arrow">
                    <code>twb.ttl</code>
                </a>
            </div>
            <ol className="modules">
                {TWB_MODULES.map((m) => (
                    <li key={m.id} id={`modul-${m.id}`} className="module">
                        <h3>
                            <span
                                className="module-dot"
                                style={{ background: MODULE_COLOURS[m.id] ?? 'var(--muted)' }}
                                aria-hidden
                            />
                            {name(m.id)}
                        </h3>
                        <a href={moduleIri(m.id)} className="module-iri">
                            {moduleIri(m.id)}
                        </a>
                        <p>{md.descriptions[m.id]![lang]}</p>
                        <p className="module-imports">
                            {md.imports[lang]}{' '}
                            {m.imports.length
                                ? m.imports.map((i, n) => (
                                      <span key={i}>
                                          {n > 0 && ', '}
                                          <a href={`#modul-${i}`}>{name(i)}</a>
                                      </span>
                                  ))
                                : md.importsNothing[lang]}
                        </p>
                        <p className="module-counts">
                            {[
                                [m.classes, md.classes],
                                [m.objectProperties, md.objectProperties],
                                [m.datatypeProperties, md.datatypeProperties],
                            ]
                                .filter(([n]) => n)
                                .map(
                                    ([n, label]) =>
                                        `${num(n as number, lang)} ${(label as typeof md.classes)[lang]}`
                                )
                                .join(' · ')}
                        </p>
                        <a href={`${BASE}ontology/twb-${m.id}.ttl`} download className="link-arrow">
                            {md.download[lang]} <code>{`twb-${m.id}.ttl`}</code>
                        </a>
                    </li>
                ))}
            </ol>
            <div className="modules-after">
                <div>
                    <h3>{md.alongsideTitle[lang]}</h3>
                    <ul className="modules-alongside">
                        {md.alongside.map((a) => (
                            <li
                                key={a.id}
                                id={`modul-${a.id.split('/')[0]}`}
                                className="module-alongside"
                            >
                                <a href={moduleIri(a.id)} className="module-iri">
                                    {moduleIri(a.id)}
                                </a>
                                <p>{a.text[lang]}</p>
                                <a href={`${BASE}ontology/${a.file}`} download className="link-arrow">
                                    {md.download[lang]} <code>{a.file}</code>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h3>{md.useTitle[lang]}</h3>
                    <pre className="module-use">
                        {`@prefix twb: <https://w3id.org/twb#> .

<https://example.org/my-ontology>
    a owl:Ontology ;
    owl:imports <https://w3id.org/twb/construction> .`}
                    </pre>
                    <p>{md.use[lang]}</p>
                </div>
            </div>
        </>
    );
}

/**
 * A small drawing per concept, in the site's line style: the thin surface with its layers, its
 * two sides, the edge between two surfaces, the opening, and the blueprint's rule over a plan.
 */
function ConceptFigure({ index }: { index: number }) {
    const figures = [
        // The surface and its recipe: a thin line, the layers drawn off it.
        <g key="s">
            <rect x="34" y="14" width="10" height="72" className="cf-layer" />
            <rect x="44" y="14" width="26" height="72" className="cf-layer is-core" />
            <rect x="70" y="14" width="6" height="72" className="cf-layer" />
            <line x1="57" y1="6" x2="57" y2="94" className="cf-surface" />
        </g>,
        // Two sides, each facing a zone; the boundary towards the wet one marked.
        <g key="z">
            <rect x="8" y="16" width="46" height="68" className="cf-zone is-wet" />
            <rect x="60" y="16" width="52" height="68" className="cf-zone" />
            <line x1="57" y1="10" x2="57" y2="90" className="cf-surface" />
            <line x1="52" y1="18" x2="52" y2="82" className="cf-req" />
        </g>,
        // Two surfaces meeting at an edge, the edge a point in section.
        <g key="e">
            <line x1="20" y1="84" x2="60" y2="20" className="cf-surface" />
            <line x1="60" y1="20" x2="100" y2="84" className="cf-surface" />
            <circle cx="60" cy="20" r="6" className="cf-edge" />
        </g>,
        // A surface hosting an opening, its four perimeter edges.
        <g key="o">
            <rect x="16" y="12" width="88" height="76" className="cf-wall" />
            <rect x="44" y="30" width="32" height="40" className="cf-opening" />
        </g>,
        // The blueprint: a rule over a plan.
        <g key="b">
            <rect x="14" y="20" width="92" height="64" className="cf-wall" />
            <line x1="62" y1="20" x2="62" y2="84" className="cf-surface" />
            <rect x="62" y="20" width="44" height="30" className="cf-zone is-wet" />
            <path d="M30 6 h60 M30 12 h40" className="cf-rule" />
        </g>,
    ];
    return (
        <svg viewBox="0 0 120 100" className="concept-figure" aria-hidden>
            {figures[index]}
        </svg>
    );
}
