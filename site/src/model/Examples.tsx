/**
 * The modelling examples: a part of the case house in `<arch-paper-model>` — the open viewer
 * element, imported from the frame-builder's own source — beside the file and the graph it
 * makes. A click on a face describes it; an edit reads the house again. The element and the RDF
 * worker load when the section comes near the screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fill, num, type Lang } from '../copy';
import { modelCopy } from './copy';
import type { TripleLine } from './engine';
import { EXAMPLES, readableJson, type ExampleId } from './example-houses';
import { rdf, type HouseSummary } from './rdf-client';

const HOUSE_BASE = 'https://example.org/house/';

type ViewerState = 'idle' | 'loading' | 'ready' | 'failed';

/** Defines `<arch-paper-model>` once, from the element's source. */
let defining: Promise<void> | null = null;
function defineViewer(): Promise<void> {
    defining ??= import('@twb/elements/arch-paper-model').then(({ ArchPaperModel }) => {
        if (!customElements.get('arch-paper-model'))
            customElements.define('arch-paper-model', ArchPaperModel);
    });
    return defining;
}

function canDraw3D(): boolean {
    try {
        return !!document.createElement('canvas').getContext('webgl2');
    } catch {
        return false;
    }
}

export function Examples({ lang }: { lang: Lang }) {
    const c = modelCopy.examples;
    const [active, setActive] = useState<ExampleId>('surface');
    const [state, setState] = useState<ViewerState>('idle');
    const [summary, setSummary] = useState<HouseSummary | null>(null);
    const [face, setFace] = useState<string | null>(null);
    const [lines, setLines] = useState<TripleLine[] | null>(null);
    const [json, setJson] = useState<string | null>(null);
    const [view, setView] = useState<'file' | 'graph'>('graph');
    const root = useRef<HTMLDivElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const example = EXAMPLES.find((e) => e.id === active)!;
    const item = c.items[active];

    // Load when the section is near.
    useEffect(() => {
        const el = root.current;
        if (!el || state !== 'idle') return;
        const io = new IntersectionObserver(
            (entries) => {
                if (!entries.some((e) => e.isIntersecting)) return;
                io.disconnect();
                if (!canDraw3D()) {
                    setState('failed');
                    return;
                }
                setState('loading');
                defineViewer().then(
                    () => setState('ready'),
                    () => setState('failed')
                );
            },
            { rootMargin: '400px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [state]);

    // Read a house into the graph, and describe the face in question.
    const read = useMemo(
        () => async (text: string, id: string | null) => {
            setJson(text);
            const s = await rdf.house(text);
            setSummary(s);
            setLines(id ? await rdf.describe(HOUSE_BASE + id) : null);
        },
        []
    );

    // The viewer, created per example so each opens framed on its own house.
    useEffect(() => {
        if (state !== 'ready' || !host.current) return;
        // Parsed rather than created: the element sets attributes in its constructor, which
        // `document.createElement` refuses and an upgrade allows.
        host.current.innerHTML =
            '<arch-paper-model class="paper-model" color-by-kind></arch-paper-model>';
        const el = host.current.firstElementChild as HTMLElement & { house: unknown };
        el.house = example.house;
        setFace(example.first);
        void read(JSON.stringify(example.house), example.first).catch(() => setSummary(null));
        let currentFace: string | null = example.first;
        const onSelect = (e: Event) => {
            const id = (e as CustomEvent<{ surfaceId: string | null }>).detail.surfaceId;
            if (!id) return;
            currentFace = id;
            setFace(id);
            void rdf.describe(HOUSE_BASE + id).then(setLines);
        };
        const onChange = (e: Event) => {
            void read((e as CustomEvent<{ json: string }>).detail.json, currentFace);
        };
        el.addEventListener('face-select', onSelect);
        el.addEventListener('house-change', onChange);
        return () => {
            el.removeEventListener('face-select', onSelect);
            el.removeEventListener('house-change', onChange);
            el.remove();
        };
    }, [state, example, read]);

    const excerpt =
        example.excerpt === null ? json && fileHead(json) : readableJson(example.excerpt);

    return (
        <div className="examples" ref={root}>
            <div className="segmented examples-tabs" role="tablist">
                {EXAMPLES.map((e) => (
                    <button
                        key={e.id}
                        role="tab"
                        aria-selected={active === e.id}
                        className={active === e.id ? 'is-on' : undefined}
                        onClick={() => setActive(e.id)}
                    >
                        {c.items[e.id].tab[lang]}
                    </button>
                ))}
            </div>
            <div className="example">
                <div className="example-text">
                    <h3>{item.title[lang]}</h3>
                    <p>{item.body[lang]}</p>
                </div>
                <div className="example-stage">
                    <div className="example-viewer" ref={host}>
                        {state !== 'ready' && (
                            <p className="example-wait">
                                {state === 'failed' ? c.failed[lang] : c.loading[lang]}
                            </p>
                        )}
                    </div>
                    <p className="fine">
                        <code>{c.element[lang]}</code>
                    </p>
                </div>
                <div className="example-side">
                    <div className="segmented segmented-small" role="tablist">
                        <button
                            role="tab"
                            aria-selected={view === 'graph'}
                            className={view === 'graph' ? 'is-on' : undefined}
                            onClick={() => setView('graph')}
                        >
                            {c.graph[lang]}
                            {summary && (
                                <span className="badge">
                                    {fill(c.triples[lang], { n: num(summary.size, lang) })}
                                </span>
                            )}
                        </button>
                        <button
                            role="tab"
                            aria-selected={view === 'file'}
                            className={view === 'file' ? 'is-on' : undefined}
                            onClick={() => setView('file')}
                        >
                            {c.file[lang]}
                        </button>
                    </div>
                    {view === 'file' ? (
                        <pre className="code">{excerpt ?? '…'}</pre>
                    ) : (
                        <div className="example-graph">
                            <p className="example-caption">
                                {face ? fill(c.selected[lang], { id: face }) : c.pick[lang]}
                            </p>
                            <pre className="code turtle">
                                {lines ? turtle(`<${face}>`, lines) : '…'}
                            </pre>
                            <p className="fine">{c.pick[lang]}</p>
                            {summary && (
                                <>
                                    <h4>{c.classes[lang]}</h4>
                                    <ul className="class-counts">
                                        {summary.classes.map((k) => (
                                            <li key={k.cls}>
                                                <code>{k.cls}</code>
                                                <span>{k.n}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** The whole house file, shortened to what fits: its first lines and its keys. */
function fileHead(json: string): string {
    const doc = JSON.parse(json) as Record<string, unknown>;
    const brief: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
        brief[k] =
            Array.isArray(v) && v.length > 2 ? [...v.slice(0, 1), `… ${v.length - 1} more`] : v;
    }
    return readableJson(brief);
}

/** Triples as Turtle: the subject once, its predicates indented, blank nodes in brackets. */
function turtle(subject: string, lines: TripleLine[], indent = '    '): string {
    const body = lines
        .slice()
        .sort((a, b) =>
            a.predicate === 'a'
                ? -1
                : b.predicate === 'a'
                  ? 1
                  : a.predicate.localeCompare(b.predicate)
        )
        .map((l) => {
            if (!l.nested) return `${indent}${l.predicate} ${l.object}`;
            const inner = turtle('', l.nested, `${indent}    `);
            return `${indent}${l.predicate} [\n${inner}\n${indent}]`;
        })
        .join(' ;\n');
    return subject ? `${subject}\n${body} .` : body;
}
