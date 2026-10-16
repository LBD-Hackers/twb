/**
 * The rule checks: the case house's rules and requirement shapes run by the RDF worker
 * (`engine.ts`), drawn on its plan. Three checks, one plan: the wet-room lining on the zone
 * boundaries (rule 30, CapabilityShape), the U-values of the use (rule 31, UValueShape), and the
 * ways out through the doors (rule 41, EgressShape). Every change the reader makes is a SPARQL
 * Update, and the whole chain runs again.
 */

import { useEffect, useRef, useState } from 'react';
import rule30 from '../../../ontology/queries/rules/30-adjacency-capabilities.rq?raw';
import rule31 from '../../../ontology/queries/rules/31-adjacency-uvalue.rq?raw';
import rule41 from '../../../ontology/queries/rules/41-passage-ways.rq?raw';
import repairText from '../../../ontology/queries/repair-wet-room-coverings.ru?raw';
import { fill, num, type Lang } from '../copy';
import { modelCopy } from './copy';
import {
    NO_CHANGES,
    TWB,
    type CheckResult,
    type Plan,
    type PlanOpening,
    type Point,
    type Scenario,
} from './engine';
import { rdf } from './rdf-client';

type Tab = 'wet' | 'u' | 'egress';
type State = 'idle' | 'loading' | 'ready' | 'failed';

const OUTDOOR = `${TWB}OutdoorAir`;
const CAPABILITIES = ['WetRoomLining', 'VapourControl', 'WindBarrier', 'WeatherProtection'];
const SHAPE_OF: Record<Tab, string> = {
    wet: 'CapabilityShape',
    u: 'UValueShape',
    egress: 'EgressShape',
};
const RULE_OF: Record<Tab, [string, string]> = {
    wet: ['30-adjacency-capabilities.rq', rule30],
    u: ['31-adjacency-uvalue.rq', rule31],
    egress: ['41-passage-ways.rq', rule41],
};

const local = (iri: string) => decodeURIComponent(iri.replace(/^.*[/#]/, ''));

export function Checks({ lang }: { lang: Lang }) {
    const c = modelCopy.checks;
    const [state, setState] = useState<State>('idle');
    const [tab, setTab] = useState<Tab>('wet');
    const [scenario, setScenario] = useState<Scenario>(NO_CHANGES);
    const [result, setResult] = useState<CheckResult | null>(null);
    const [running, setRunning] = useState(false);
    const [capability, setCapability] = useState('WetRoomLining');
    const [baseU, setBaseU] = useState<Record<string, number>>({});
    const root = useRef<HTMLDivElement>(null);

    // Start the engine when the section is near.
    useEffect(() => {
        const el = root.current;
        if (!el || state !== 'idle') return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    io.disconnect();
                    setState('loading');
                }
            },
            { rootMargin: '300px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [state]);

    // Run whenever the scenario changes; the last answer wins.
    useEffect(() => {
        if (state === 'idle' || state === 'failed') return;
        let current = true;
        setRunning(true);
        rdf.check(scenario).then(
            (r) => {
                if (!current) return;
                setResult(r);
                setRunning(false);
                setState('ready');
                setBaseU((b) =>
                    Object.keys(b).length > 0
                        ? b
                        : Object.fromEntries(r.uValues.map((u) => [u.recipe, u.u]))
                );
            },
            (err: unknown) => {
                console.error('TWB rule check failed', err);
                if (current) setState('failed');
            }
        );
        return () => {
            current = false;
        };
    }, [scenario, state === 'idle' || state === 'failed']);

    const violations = result?.violations.filter((v) => v.shape === SHAPE_OF[tab]) ?? [];
    const allViolations = result?.violations.length ?? 0;

    return (
        <div className="checks" ref={root}>
            <div className="checks-head">
                <div className="segmented" role="tablist">
                    {(['wet', 'u', 'egress'] as const).map((k) => {
                        const n =
                            result?.violations.filter((v) => v.shape === SHAPE_OF[k]).length ?? 0;
                        return (
                            <button
                                key={k}
                                role="tab"
                                aria-selected={tab === k}
                                className={tab === k ? 'is-on' : undefined}
                                onClick={() => setTab(k)}
                            >
                                {c.tabs[k][lang]}
                                {result && (
                                    <span
                                        className={
                                            n > 0 ? 'status-badge is-fail' : 'status-badge is-ok'
                                        }
                                    >
                                        {n > 0 ? `✕ ${n}` : '✓'}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                {result && (
                    <p
                        className={allViolations > 0 ? 'verdict is-fail' : 'verdict is-ok'}
                        aria-live="polite"
                    >
                        {allViolations > 0
                            ? `✕ ${fill(c.violations[lang], { n: allViolations })}`
                            : `✓ ${c.conforms[lang]}`}
                        {running && <span className="muted"> · {c.running[lang]}</span>}
                    </p>
                )}
            </div>
            <div className="checks-body">
                <figure className="checks-plan">
                    {result ? (
                        <PlanView
                            lang={lang}
                            tab={tab}
                            result={result}
                            capability={capability}
                            scenario={scenario}
                            setScenario={setScenario}
                        />
                    ) : (
                        <p className="example-wait">
                            {state === 'failed' ? c.failed[lang] : c.loading[lang]}
                        </p>
                    )}
                    {result && <PlanLegend lang={lang} tab={tab} />}
                </figure>
                <div className="checks-side">
                    <h3>{c[tab].title[lang]}</h3>
                    <p>{c[tab].body[lang]}</p>
                    {result && tab === 'wet' && (
                        <>
                            <div
                                className="chips"
                                role="radiogroup"
                                aria-label={c.wet.capability[lang]}
                            >
                                {CAPABILITIES.map((k) => (
                                    <button
                                        key={k}
                                        role="radio"
                                        aria-checked={capability === k}
                                        className={capability === k ? 'chip is-on' : 'chip'}
                                        onClick={() => setCapability(k)}
                                    >
                                        {c.capabilities[k]![lang]}
                                    </button>
                                ))}
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={scenario.repair}
                                    onChange={(e) =>
                                        setScenario((s) => ({ ...s, repair: e.target.checked }))
                                    }
                                />
                                {c.wet.repair[lang]}
                            </label>
                            <RequirementList lang={lang} result={result} capability={capability} />
                            <details className="query">
                                <summary>repair-wet-room-coverings.ru</summary>
                                <pre className="code">{repairText.trim()}</pre>
                            </details>
                        </>
                    )}
                    {result && tab === 'u' && (
                        <UValues
                            lang={lang}
                            result={result}
                            base={baseU}
                            scenario={scenario}
                            setScenario={setScenario}
                        />
                    )}
                    {result && tab === 'egress' && (
                        <>
                            <ul className="ways">
                                {result.ways.map((w) => (
                                    <li key={w.zone} className={w.canLeave ? 'is-ok' : 'is-fail'}>
                                        <span aria-hidden>{w.canLeave ? '✓' : '✕'}</span>
                                        {c.rooms[w.label]?.[lang] ?? w.label}
                                        <span className="muted">
                                            {' '}
                                            —{' '}
                                            {w.canLeave
                                                ? c.egress.canLeave[lang]
                                                : c.egress.trapped[lang]}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <button
                                className="chip"
                                disabled={Object.keys(scenario.openableFrom).length === 0}
                                onClick={() => setScenario((s) => ({ ...s, openableFrom: {} }))}
                            >
                                {c.egress.reset[lang]}
                            </button>
                        </>
                    )}
                    {result && (
                        <>
                            <h4 className="checks-result-head">{c.results[lang]}</h4>
                            {violations.length === 0 ? (
                                <p className="violation is-ok">
                                    ✓ {SHAPE_OF[tab]}: {c.conforms[lang]}
                                </p>
                            ) : (
                                <ul className="violations">
                                    {violations.map((v, i) => (
                                        <li key={i} className="violation is-fail">
                                            <span aria-hidden>✕</span> <code>{SHAPE_OF[tab]}</code>{' '}
                                            {v.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <details className="query">
                                <summary>
                                    {c.showRule[lang]}: <code>{RULE_OF[tab][0]}</code>
                                </summary>
                                <pre className="code">{RULE_OF[tab][1].trim()}</pre>
                            </details>
                            <details className="query">
                                <summary>
                                    {c.showShape[lang]}: <code>twbsh:{SHAPE_OF[tab]}</code>
                                </summary>
                                <pre className="code">
                                    {result.constraints
                                        .filter((k) => k.shape === SHAPE_OF[tab])
                                        .map((k) => `# ${k.message}\n${k.select.trim()}`)
                                        .join('\n\n')}
                                </pre>
                            </details>
                            <details className="query">
                                <summary>{c.showUpdate[lang]}</summary>
                                <pre className="code">
                                    {[
                                        ...result.updates,
                                        ...(scenario.repair
                                            ? ['# repair-wet-room-coverings.ru']
                                            : []),
                                    ].join('\n\n') || c.noUpdate[lang]}
                                </pre>
                            </details>
                            <p className="fine">
                                {fill(c.stats[lang], {
                                    explicit: num(result.triples.explicit, lang),
                                    inferred: num(result.triples.inferred, lang),
                                    rules: result.ms.rules,
                                    checks: result.ms.checks,
                                })}
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── The plan ────────────────────────────────────────────────────────────────────────────────

const PAD = 900;

function PlanView({
    lang,
    tab,
    result,
    capability,
    scenario,
    setScenario,
}: {
    lang: Lang;
    tab: Tab;
    result: CheckResult;
    capability: string;
    scenario: Scenario;
    setScenario: (f: (s: Scenario) => Scenario) => void;
}) {
    const c = modelCopy.checks;
    const { plan } = result;
    const xs = plan.outline.map((p) => p[0]);
    const ys = plan.outline.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // North up: plan y runs up the page.
    const P = (p: Point): Point => [p[0] - minX, maxY - p[1]];
    const pts = (ps: Point[]) => ps.map((p) => P(p).join(',')).join(' ');
    const zoneById = new Map(plan.zones.map((z) => [z.id, z]));
    const wallById = new Map(plan.walls.map((w) => [w.id, w]));
    const canLeave = new Map(result.ways.map((w) => [w.zone, w.canLeave]));
    const uBySurface = new Map(result.uValues.map((u) => [u.surface, u]));

    const requirements = result.requirements.filter((r) => r.capability === `${TWB}${capability}`);
    const floorReqs = requirements.filter((r) => !wallById.has(r.surface));

    return (
        <svg
            viewBox={`${-PAD} ${-PAD} ${maxX - minX + 2 * PAD} ${maxY - minY + 2 * PAD}`}
            className="check-svg"
            role="img"
            aria-label={c[tab].title[lang]}
        >
            <defs>
                <pattern
                    id="hatch-fail"
                    width="160"
                    height="160"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                >
                    <rect width="160" height="160" className="hatch-bg is-fail" />
                    <line x1="0" y1="0" x2="0" y2="160" className="hatch-line is-fail" />
                </pattern>
                <pattern
                    id="hatch-ok"
                    width="160"
                    height="160"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(135)"
                >
                    <rect width="160" height="160" className="hatch-bg is-ok" />
                    <line x1="0" y1="0" x2="0" y2="160" className="hatch-line is-ok" />
                </pattern>
            </defs>
            {plan.zones.map((z) => {
                let cls = 'zone';
                if (tab === 'egress') cls += canLeave.get(z.id) ? ' is-ok' : ' is-fail';
                if (tab === 'wet' && z.wet) cls += ' is-wet';
                return <polygon key={z.id} points={pts(z.outline)} className={cls} />;
            })}
            {/* A requirement on a floor or ceiling boundary covers the room it faces. */}
            {tab === 'wet' &&
                floorReqs.map((r) => {
                    const z = zoneById.get(r.zone);
                    if (!z) return null;
                    return (
                        <polygon
                            key={r.boundary}
                            points={pts(inset(z.outline, 160))}
                            fill={r.providedBy ? 'url(#hatch-ok)' : 'url(#hatch-fail)'}
                            className="floor-req"
                        >
                            <title>{`${local(r.surface)} → ${z.label}: ${r.providedBy ?? c.fails[lang]}`}</title>
                        </polygon>
                    );
                })}
            {plan.walls.map((w) => {
                let cls = w.exterior ? 'wall is-exterior' : 'wall';
                const u = uBySurface.get(w.id);
                if (tab === 'u' && u) cls += u.u > u.max ? ' is-fail' : ' is-ok';
                const [a, b] = [P(w.a), P(w.b)];
                return <line key={w.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={cls} />;
            })}
            {/* Zone-boundary requirements on walls: a band on the side of the zone, as long as the zone runs. */}
            {tab === 'wet' &&
                requirements.map((r) => {
                    const w = wallById.get(r.surface);
                    const z = zoneById.get(r.zone);
                    const band = w
                        ? boundaryBand(w.a, w.b, z?.outline ?? null, z?.seed ?? null)
                        : null;
                    if (!band) return null;
                    const [a, b] = [P(band[0]), P(band[1])];
                    const cls =
                        r.providedBy === 'covering'
                            ? 'band is-covering'
                            : r.providedBy
                              ? 'band is-ok'
                              : 'band is-fail';
                    return (
                        <line
                            key={r.boundary}
                            x1={a[0]}
                            y1={a[1]}
                            x2={b[0]}
                            y2={b[1]}
                            className={cls}
                        >
                            <title>{`${local(r.surface)} → ${z?.label ?? local(r.zone)}`}</title>
                        </line>
                    );
                })}
            {plan.openings.map((o) => {
                const [a, b] = [P(o.a), P(o.b)];
                return (
                    <line
                        key={o.id}
                        x1={a[0]}
                        y1={a[1]}
                        x2={b[0]}
                        y2={b[1]}
                        className={o.kind === 'Door' ? 'opening is-door' : 'opening'}
                    />
                );
            })}
            {tab === 'u' &&
                plan.walls.map((w) => {
                    const u = uBySurface.get(w.id);
                    if (!u) return null;
                    const m = mid(w.a, w.b);
                    const out = outward(w.a, w.b, plan, 520);
                    const [x, y] = P([m[0] + out[0], m[1] + out[1]]);
                    return (
                        <text
                            key={w.id}
                            x={x}
                            y={y}
                            className={u.u > u.max ? 'plan-value is-fail' : 'plan-value'}
                            textAnchor="middle"
                            dominantBaseline="middle"
                        >
                            {u.u > u.max ? '✕ ' : '✓ '}
                            {num(u.u, lang, 2)}
                        </text>
                    );
                })}
            {tab === 'egress' && (
                <Ways
                    lang={lang}
                    result={result}
                    P={P}
                    scenario={scenario}
                    setScenario={setScenario}
                />
            )}
            {plan.zones.map((z) => {
                // Clear of the door buttons and arrows on the ways-out plan.
                const [x, y] = P(tab === 'egress' ? [z.seed[0], z.seed[1] + 520] : z.seed);
                return (
                    <text
                        key={z.id}
                        x={x}
                        y={y}
                        className="plan-name"
                        textAnchor="middle"
                        dominantBaseline="middle"
                    >
                        {tab === 'egress' && (canLeave.get(z.id) ? '✓ ' : '✕ ')}
                        {c.rooms[z.label]?.[lang] ?? z.label}
                    </text>
                );
            })}
        </svg>
    );
}

/** The arrows of `twb:leadsTo` through each door, and the door as a button. */
function Ways({
    lang,
    result,
    P,
    scenario,
    setScenario,
}: {
    lang: Lang;
    result: CheckResult;
    P: (p: Point) => Point;
    scenario: Scenario;
    setScenario: (f: (s: Scenario) => Scenario) => void;
}) {
    const c = modelCopy.checks;
    const { plan } = result;
    const zoneById = new Map(plan.zones.map((z) => [z.id, z]));
    const leads = new Set(result.leadsTo.map(([a, b]) => `${a}>${b}`));
    const name = (z: string) =>
        z === OUTDOOR
            ? c.egress.outdoors[lang]
            : (c.rooms[zoneById.get(z)?.label ?? '']?.[lang] ?? local(z));

    const cycle = (o: PlanOpening) => {
        const p = o.passage!;
        setScenario((s) => {
            const from = { ...s.openableFrom };
            const now = from[p];
            const i = now ? o.zones.indexOf(now) : -1;
            if (i + 1 < o.zones.length) from[p] = o.zones[i + 1]!;
            else delete from[p];
            return { ...s, openableFrom: from };
        });
    };

    return (
        <g>
            {plan.openings
                .filter((o) => o.passage && o.zones.length === 2)
                .map((o) => {
                    const m = mid(o.a, o.b);
                    const along = unit([o.b[0] - o.a[0], o.b[1] - o.a[1]]);
                    const normal: Point = [-along[1], along[0]];
                    // Which side of the door each zone is on: a room by its seed, the outdoors opposite.
                    const sideOf = (z: string): number => {
                        const room = zoneById.get(z);
                        if (room)
                            return (
                                Math.sign(
                                    dot([room.seed[0] - m[0], room.seed[1] - m[1]], normal)
                                ) || 1
                            );
                        const other = o.zones.find((k) => k !== z)!;
                        return -sideOf(other);
                    };
                    const [z1, z2] = o.zones as [string, string];
                    const arrows = (
                        [
                            [z1, z2],
                            [z2, z1],
                        ] as const
                    ).filter(([a, b]) => leads.has(`${a}>${b}`));
                    const restricted = scenario.openableFrom[o.passage!];
                    const label = restricted
                        ? fill(c.egress.from[lang], { zone: name(restricted) })
                        : c.egress.both[lang];
                    const [cx, cy] = P(m);
                    return (
                        <g key={o.id}>
                            {arrows.map(([a, b], i) => {
                                const sa = sideOf(a);
                                const shift = arrows.length === 2 ? (i === 0 ? -170 : 170) : 0;
                                const start: Point = [
                                    m[0] + normal[0] * sa * 620 + along[0] * shift,
                                    m[1] + normal[1] * sa * 620 + along[1] * shift,
                                ];
                                const end: Point = [
                                    m[0] - normal[0] * sa * 620 + along[0] * shift,
                                    m[1] - normal[1] * sa * 620 + along[1] * shift,
                                ];
                                const [x1, y1] = P(start);
                                const [x2, y2] = P(end);
                                return (
                                    <line
                                        key={`${a}>${b}`}
                                        x1={x1}
                                        y1={y1}
                                        x2={x2}
                                        y2={y2}
                                        className="way"
                                        markerEnd="url(#way-head)"
                                    >
                                        <title>{`${name(a)} → ${name(b)}`}</title>
                                    </line>
                                );
                            })}
                            <g
                                className={restricted ? 'door-button is-restricted' : 'door-button'}
                                role="button"
                                tabIndex={0}
                                aria-label={label}
                                onClick={() => cycle(o)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        cycle(o);
                                    }
                                }}
                            >
                                <title>{label}</title>
                                <circle cx={cx} cy={cy} r={230} />
                                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                                    {restricted ? '🔒' : '⇄'}
                                </text>
                            </g>
                        </g>
                    );
                })}
            <defs>
                <marker
                    id="way-head"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                >
                    <path d="M0,0 L10,5 L0,10 z" className="way-head" />
                </marker>
            </defs>
        </g>
    );
}

function PlanLegend({ lang, tab }: { lang: Lang; tab: Tab }) {
    const l = modelCopy.checks.legend;
    return (
        <figcaption className="check-legend">
            <span>
                <i className="key is-ok" /> ✓ {l.ok[lang]}
            </span>
            <span>
                <i className="key is-fail" /> ✕ {l.fail[lang]}
            </span>
            {tab === 'wet' && (
                <span>
                    <i className="key is-covering" /> ✓ {l.covering[lang]}
                </span>
            )}
        </figcaption>
    );
}

function RequirementList({
    lang,
    result,
    capability,
}: {
    lang: Lang;
    result: CheckResult;
    capability: string;
}) {
    const c = modelCopy.checks;
    const zoneLabel = new Map(result.plan.zones.map((z) => [z.id, z.label]));
    const rows = result.requirements
        .filter((r) => r.capability === `${TWB}${capability}`)
        .sort(
            (a, b) =>
                Number(!!a.providedBy) - Number(!!b.providedBy) ||
                a.surface.localeCompare(b.surface)
        );
    return (
        <ul className="requirements">
            {rows.map((r) => {
                const zone =
                    r.zone === OUTDOOR
                        ? c.egress.outdoors[lang]
                        : (c.rooms[zoneLabel.get(r.zone) ?? '']?.[lang] ?? local(r.zone));
                return (
                    <li key={r.boundary} className={r.providedBy ? 'is-ok' : 'is-fail'}>
                        <span aria-hidden>{r.providedBy ? '✓' : '✕'}</span>
                        <code>{local(r.surface)}</code> → {zone}
                        <span className="muted">
                            {' '}
                            —{' '}
                            {r.providedBy
                                ? `${c.ok[lang]} (${c.okBy[r.providedBy][lang]})`
                                : c.fails[lang]}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

/** The U-value check: a bar per surface against its limit, and a slider per recipe. */
function UValues({
    lang,
    result,
    base,
    scenario,
    setScenario,
}: {
    lang: Lang;
    result: CheckResult;
    base: Record<string, number>;
    scenario: Scenario;
    setScenario: (f: (s: Scenario) => Scenario) => void;
}) {
    const c = modelCopy.checks.u;
    const names = modelCopy.checks.recipes;
    const recipes = [...new Map(result.uValues.map((u) => [u.recipe, u])).values()];
    const scaleMax = 0.5;
    const W = 420;
    const row = 30;
    const left = 92;
    const x = (v: number) => left + (Math.min(v, scaleMax) / scaleMax) * (W - left - 44);
    return (
        <div className="uvalues">
            {recipes.map((r) => (
                <label key={r.recipe} className="slider">
                    <span>
                        {names[local(r.recipe)]?.[lang] ?? r.recipeLabel}{' '}
                        <strong>{num(r.u, lang, 3)}</strong>{' '}
                        <span className="muted">
                            ({c.limit[lang]} {num(r.max, lang, 2)})
                        </span>
                    </span>
                    <input
                        type="range"
                        min={0.08}
                        max={0.45}
                        step={0.005}
                        value={scenario.uValues[r.recipe] ?? base[r.recipe] ?? r.u}
                        onChange={(e) =>
                            setScenario((s) => ({
                                ...s,
                                uValues: { ...s.uValues, [r.recipe]: Number(e.target.value) },
                            }))
                        }
                    />
                </label>
            ))}
            <button
                className="chip"
                disabled={Object.keys(scenario.uValues).length === 0}
                onClick={() => setScenario((s) => ({ ...s, uValues: {} }))}
            >
                {c.reset[lang]}
            </button>
            <svg
                viewBox={`0 0 ${W} ${result.uValues.length * row + 30}`}
                className="u-chart"
                role="img"
                aria-label={c.axis[lang]}
            >
                {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => (
                    <g key={t}>
                        <line
                            x1={x(t)}
                            x2={x(t)}
                            y1={0}
                            y2={result.uValues.length * row}
                            className="u-grid"
                        />
                        <text
                            x={x(t)}
                            y={result.uValues.length * row + 16}
                            textAnchor="middle"
                            className="u-tick"
                        >
                            {num(t, lang, 1)}
                        </text>
                    </g>
                ))}
                {result.uValues.map((u, i) => {
                    const over = u.u > u.max;
                    const y = i * row + 6;
                    return (
                        <g key={u.surface}>
                            <title>{`${local(u.surface)} · ${u.recipeLabel}: ${num(u.u, lang, 3)} / ${num(u.max, lang, 2)} W/m²K`}</title>
                            <text x={left - 8} y={y + 9} textAnchor="end" className="u-label">
                                {local(u.surface)}
                            </text>
                            <rect
                                x={left}
                                y={y}
                                width={Math.max(2, x(u.u) - left)}
                                height={18}
                                rx={4}
                                className={over ? 'u-bar is-fail' : 'u-bar is-ok'}
                            />
                            <line
                                x1={x(u.max)}
                                x2={x(u.max)}
                                y1={y - 3}
                                y2={y + 21}
                                className="u-limit"
                            />
                            <text
                                x={x(u.u) + 6}
                                y={y + 9}
                                dominantBaseline="middle"
                                className="u-value"
                            >
                                {over ? '✕' : '✓'} {num(u.u, lang, 2)}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <p className="fine">
                <span className="u-limit-key" /> {c.limit[lang]} · {c.axis[lang]}
            </p>
        </div>
    );
}

// ── Plan geometry ───────────────────────────────────────────────────────────────────────────

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const unit = (v: Point): Point => {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
};

/**
 * The stretch of a wall a zone runs along, moved off the wall line towards the zone: where a
 * zone boundary's requirement is drawn.
 */
function boundaryBand(
    a: Point,
    b: Point,
    outline: Point[] | null,
    seed: Point | null
): [Point, Point] | null {
    const d: Point = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(d[0], d[1]);
    const u = unit(d);
    let t0 = 0;
    let t1 = len;
    if (outline) {
        const ts = outline.map((p) => dot([p[0] - a[0], p[1] - a[1]], u));
        t0 = Math.max(0, Math.min(...ts));
        t1 = Math.min(len, Math.max(...ts));
        if (t1 - t0 < 1) return null;
    }
    const n: Point = [-u[1], u[0]];
    const side = seed ? Math.sign(dot([seed[0] - a[0], seed[1] - a[1]], n)) || 1 : 1;
    const off = 150 * side;
    const inset = 120;
    return [
        [a[0] + u[0] * (t0 + inset) + n[0] * off, a[1] + u[1] * (t0 + inset) + n[1] * off],
        [a[0] + u[0] * (t1 - inset) + n[0] * off, a[1] + u[1] * (t1 - inset) + n[1] * off],
    ];
}

/** A rectangle-ish outline pulled in by `d` towards its centre. */
function inset(outline: Point[], d: number): Point[] {
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
    const cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
    return outline.map((p) => [p[0] + Math.sign(cx - p[0]) * d, p[1] + Math.sign(cy - p[1]) * d]);
}

/** A wall's outward offset: away from the middle of the floor. */
function outward(a: Point, b: Point, plan: Plan, d: number): Point {
    const xs = plan.outline.map((p) => p[0]);
    const ys = plan.outline.map((p) => p[1]);
    const centre: Point = [
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
    ];
    const m = mid(a, b);
    const u = unit([b[0] - a[0], b[1] - a[1]]);
    const n: Point = [-u[1], u[0]];
    const s = Math.sign(dot([m[0] - centre[0], m[1] - centre[1]], n)) || 1;
    return [n[0] * s * d, n[1] * s * d];
}
