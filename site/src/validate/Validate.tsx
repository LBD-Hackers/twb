/**
 * The validator: a house file, an IFC model or a TWB graph, checked in the browser with
 * `@lbd-hackers/twb/validate` — the same code as `twb validate` — in a worker, level by level. A
 * house file (or the house an IFC model becomes) is shown in `<arch-paper-model>` beside its
 * findings. Nothing leaves the browser.
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Finding, Severity } from '@twb/validate';
import caseHouse from '../../../ontology/examples/case-house.json?raw';
import caseGraph from '../../../ontology/examples/case-house.ttl?raw';
import caseRules from '../../../ontology/examples/case-house-rules.ttl?raw';
import caseUseRules from '../../../ontology/examples/case-house-use-rules.ttl?raw';
import { BASE } from '../copy';
import type { InputFile, ValidateRequest, ValidateResponse } from './protocol';
import './validate.css';

/** A house file with something wrong at every level the validator reads. */
const BROKEN_HOUSE = JSON.stringify(
    {
        '@context': 'https://w3id.org/twb/context/3.jsonld',
        format: 'twb/1',
        type: 'Blueprint',
        name: 'A house with mistakes',
        wallHeightMm: 2400,
        walls: [{ points: [[0, 0], [9600, 0], [9600, 7200], [0, 7200], [0, 0]] }],
        openings: [
            { kind: 'window', at: [4800, 0], widthMm: 1200, heightMm: 1200, sillMm: 900 },
            { kind: 'window', at: [4800, 3600], widthMm: 1200, heightMm: 1200 },
        ],
        roof: { type: 'gable', pitchDeg: 30 },
        zones: [
            { type: 'Room', name: 'Living', zoneKind: 'living', point: [2400, 3600] },
            { type: 'Room', name: 'Sauna', zoneKind: 'sauna', point: [7200, 3600] },
        ],
        surfaces: [{ type: 'Surface', id: 'shed', points: [[0, 0, 0], [1000, 0]] }],
        colour: 'red',
    },
    null,
    2
);

interface Example {
    id: string;
    label: string;
    note: string;
    files: InputFile[];
}

const EXAMPLES: Example[] = [
    {
        id: 'house',
        label: 'The case house',
        note: 'the paper’s house file, twb/1',
        files: [{ name: 'case-house.twb.jsonld', text: caseHouse }],
    },
    {
        id: 'broken',
        label: 'A house with mistakes',
        note: 'one at every level',
        files: [{ name: 'mistakes.twb.jsonld', text: BROKEN_HOUSE }],
    },
    {
        id: 'graph',
        label: 'The case house as a TWB graph',
        note: 'derived by arch, with its rules — five wet-room violations',
        files: [
            { name: 'case-house.ttl', text: caseGraph },
            { name: 'case-house-rules.ttl', text: caseRules },
            { name: 'case-house-use-rules.ttl', text: caseUseRules },
        ],
    },
];

const LEVEL_TITLES: Record<string, { title: string; about: string }> = {
    import: { title: 'Import', about: 'The IFC model read into a house file.' },
    file: { title: 'File', about: 'The JSON’s shape: every corner three numbers, every list a list.' },
    geometry: {
        title: 'Geometry',
        about: 'The house opened into a model: planar faces, openings inside their faces, partitions built, rooms found.',
    },
    vocabulary: {
        title: 'Vocabulary',
        about: 'Read as JSON-LD: every key a term of the context, every twb: term defined, every catalogue value known.',
    },
    parse: { title: 'Parse', about: 'The graph read as RDF.' },
    rules: { title: 'Rules', about: 'The SPARQL rules, applied in order: requirements, ways out, resolved joints.' },
    shapes: { title: 'Shapes', about: 'The SHACL shapes of twb-shapes.ttl, Core and SPARQL constraints.' },
};

const SEVERITY_ICON: Record<Severity, string> = { error: '✕', warning: '!', info: 'i' };

let paperModel: Promise<unknown> | null = null;
/** Defines `<arch-paper-model>` once, from the library's source. */
const definePaperModel = () =>
    (paperModel ??= import('@twb/elements/arch-paper-model').then(({ ArchPaperModel }) => {
        if (!customElements.get('arch-paper-model'))
            customElements.define('arch-paper-model', ArchPaperModel);
    }));

const readFile = (f: File): Promise<InputFile> => f.text().then((text) => ({ name: f.name, text }));

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/ld+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

/** The shape's card in the reference, for a finding of the shapes level. */
const shapeHref = (shape: string) =>
    `${BASE}reference/#shape-${shape.replace(/^.*[#:/]/, '')}`;

function FindingRow({ finding }: { finding: Finding }) {
    const r = finding.result;
    return (
        <li className={`v-finding is-${finding.severity}`}>
            <span className="v-icon" aria-label={finding.severity}>
                {SEVERITY_ICON[finding.severity]}
            </span>
            <div>
                <p>{finding.message}</p>
                {(finding.where || r) && (
                    <p className="v-where">
                        {finding.where && <code>{finding.where}</code>}
                        {r?.path && <code>{r.path}</code>}
                        {r && (
                            <a href={shapeHref(r.shape)} title={r.component}>
                                {r.shape.replace(/^.*[#:/]/, '')}
                            </a>
                        )}
                        {r?.value && <code>{r.value}</code>}
                    </p>
                )}
            </div>
        </li>
    );
}

function Results({
    response,
    showInfo,
}: {
    response: ValidateResponse;
    showInfo: boolean;
}) {
    const report = response.report;
    if (!report) {
        return (
            <div className="v-verdict is-error">
                <strong>Not something the validator reads.</strong>{' '}
                {response.input.kind === 'unknown' ? `It seems ${response.input.reason}.` : ''}
            </div>
        );
    }
    const { error, warning, info } = report.counts;
    return (
        <>
            <div className={`v-verdict ${error ? 'is-error' : warning ? 'is-warning' : 'is-ok'}`}>
                <strong>
                    {error
                        ? `${error} error${error === 1 ? '' : 's'}`
                        : warning
                          ? 'Valid, with warnings'
                          : 'Valid'}
                </strong>
                <span>
                    {warning} warning{warning === 1 ? '' : 's'} · {info} note{info === 1 ? '' : 's'}{' '}
                    · {report.kind === 'graph' ? 'a TWB graph' : report.kind === 'ifc' ? 'an IFC model' : 'a house file'}{' '}
                    · {(report.ms / 1000).toFixed(1)} s
                </span>
            </div>
            <dl className="v-summary">
                {Object.entries(report.summary).map(([k, v]) => (
                    <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                    </div>
                ))}
            </dl>
            {response.ignored.length > 0 && (
                <p className="v-note">Left out, not RDF graphs: {response.ignored.join(', ')}.</p>
            )}
            <ol className="v-levels">
                {report.levels.map((level) => {
                    const shown = level.findings.filter((f) => showInfo || f.severity !== 'info');
                    const worst = level.findings.some((f) => f.severity === 'error')
                        ? 'error'
                        : level.findings.some((f) => f.severity === 'warning')
                          ? 'warning'
                          : 'ok';
                    const t =
                        level.name === 'vocabulary' && report.kind === 'graph'
                            ? {
                                  title: 'Vocabulary',
                                  about: 'Every twb: term the graph uses defined by the ontology, every catalogue value known.',
                              }
                            : (LEVEL_TITLES[level.name] ?? { title: level.name, about: '' });
                    return (
                        <li key={level.name} className={`v-level is-${level.ran ? worst : 'skipped'}`}>
                            <header>
                                <h3>{t.title}</h3>
                                <span className="v-level-status">
                                    {!level.ran
                                        ? 'not run'
                                        : worst === 'ok'
                                          ? 'passed'
                                          : `${level.findings.filter((f) => f.severity === worst).length} ${worst}${level.findings.filter((f) => f.severity === worst).length === 1 ? '' : 's'}`}
                                    {level.ran && <span> · {level.ms} ms</span>}
                                </span>
                            </header>
                            <p className="v-about">{t.about}</p>
                            {shown.length > 0 && (
                                <ul className="v-findings">
                                    {shown.map((f, i) => (
                                        <FindingRow key={i} finding={f} />
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ol>
        </>
    );
}

/** The house in `<arch-paper-model>`, read-only, tinted by what each face is. */
function HouseView({ house }: { house: string }) {
    const host = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        definePaperModel()
            .then(() => {
                if (cancelled || !host.current) return;
                host.current.innerHTML = '<arch-paper-model readonly color-by-kind></arch-paper-model>';
                (host.current.firstElementChild as HTMLElement & { house: string }).house = house;
            })
            .catch(() => setFailed(true));
        return () => {
            cancelled = true;
        };
    }, [house]);
    return failed ? (
        <p className="v-note">The viewer could not start here (it needs WebGL2).</p>
    ) : (
        <div ref={host} className="v-view" />
    );
}

export function Validate() {
    const worker = useMemo(
        () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
        []
    );
    const [files, setFiles] = useState<InputFile[]>([]);
    const [rules, setRules] = useState(true);
    const [busy, setBusy] = useState(false);
    const [response, setResponse] = useState<ValidateResponse | null>(null);
    const [showInfo, setShowInfo] = useState(true);
    const [paste, setPaste] = useState('');
    const [dragging, setDragging] = useState(false);
    const nextId = useRef(0);
    const picker = useRef<HTMLInputElement>(null);

    useEffect(() => {
        worker.onmessage = (e: MessageEvent<ValidateResponse>) => {
            if (e.data.id !== nextId.current) return;
            setResponse(e.data);
            setBusy(false);
        };
        return () => worker.terminate();
    }, [worker]);

    const run = (input: InputFile[], withRules = rules) => {
        if (input.length === 0) return;
        // The model is the one file that is not an extra graph of rules: the first, or the
        // largest when several are given at once.
        const sorted = [...input].sort((a, b) => b.text.length - a.text.length);
        const [main, ...extra] = input.length > 1 ? sorted : input;
        setFiles([main!, ...extra]);
        setBusy(true);
        const id = ++nextId.current;
        const request: ValidateRequest = { id, ...main!, rules: withRules, extra };
        worker.postMessage(request);
    };

    const onFiles = async (list: FileList | null) => {
        if (list?.length) run(await Promise.all([...list].map(readFile)));
    };

    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        void onFiles(e.dataTransfer.files);
    };

    const main = files[0];
    const isGraph = response?.input.kind === 'graph';

    return (
        <section className="section v-page">
            <div className="wrap">
                <header className="section-head">
                    <p className="kicker">Validate</p>
                    <h2>Is it a TWB model?</h2>
                    <p className="lead">
                        Drop a house file (<code>.twb.jsonld</code>), an IFC model (<code>.ifc</code>)
                        or a TWB graph (<code>.ttl</code>, JSON-LD, RDF/XML). It is checked in your
                        browser — nothing is uploaded — with the same code as{' '}
                        <code>npx @lbd-hackers/twb validate</code>: the file’s shape, its geometry,
                        its vocabulary against the ontology and the catalogue, and, for a graph,
                        the rules and the SHACL shapes.
                    </p>
                </header>

                <div
                    className={`v-drop${dragging ? ' is-over' : ''}`}
                    onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                >
                    <p>
                        <strong>Drop files here</strong> or{' '}
                        <button type="button" className="link-arrow" onClick={() => picker.current?.click()}>
                            choose files
                        </button>
                        . With a graph, drop its rule files beside it (e.g.{' '}
                        <code>case-house-rules.ttl</code>).
                    </p>
                    <input
                        ref={picker}
                        type="file"
                        multiple
                        hidden
                        accept=".jsonld,.json,.ifc,.ttl,.nt,.rdf,.owl,.xml"
                        onChange={(e) => void onFiles(e.target.files)}
                    />
                    <div className="v-examples">
                        <span>Or try:</span>
                        {EXAMPLES.map((ex) => (
                            <button key={ex.id} type="button" onClick={() => run(ex.files)} title={ex.note}>
                                {ex.label}
                            </button>
                        ))}
                    </div>
                    <details className="v-paste">
                        <summary>Paste a file instead</summary>
                        <textarea
                            value={paste}
                            onChange={(e) => setPaste(e.target.value)}
                            placeholder='{ "@context": "https://w3id.org/twb/context/3.jsonld", "format": "twb/1", … } — or Turtle'
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            className="button"
                            disabled={!paste.trim()}
                            onClick={() => {
                                const t = paste.trimStart();
                                const name = t.startsWith('{') || t.startsWith('[')
                                    ? 'pasted.jsonld'
                                    : t.startsWith('ISO-10303-21')
                                      ? 'pasted.ifc'
                                      : 'pasted.ttl';
                                run([{ name, text: paste }]);
                            }}
                        >
                            Validate
                        </button>
                    </details>
                </div>

                <div className="v-options">
                    <label>
                        <input
                            type="checkbox"
                            checked={rules}
                            onChange={(e) => {
                                setRules(e.target.checked);
                                if (isGraph && files.length) run(files, e.target.checked);
                            }}
                        />{' '}
                        Apply the rules to a graph before the shapes (takes a few seconds)
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={showInfo}
                            onChange={(e) => setShowInfo(e.target.checked)}
                        />{' '}
                        Show notes
                    </label>
                </div>

                {main && (
                    <p className="v-file">
                        <code>{main.name}</code>
                        {files.length > 1 && (
                            <span>
                                {' '}
                                with {files.slice(1).map((f) => f.name).join(', ')}
                            </span>
                        )}
                        {busy && <span className="v-busy"> — validating…</span>}
                    </p>
                )}

                {response && (
                    <div className={`v-result${response.house ? ' has-view' : ''}${busy ? ' is-stale' : ''}`}>
                        <div className="v-report">
                            <Results response={response} showInfo={showInfo} />
                        </div>
                        {response.house && (
                            <div className="v-side">
                                <HouseView house={response.house} />
                                {response.input.kind === 'ifc' && (
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={() =>
                                            download(
                                                `${main?.name.replace(/\.ifc$/i, '') ?? 'house'}.twb.jsonld`,
                                                response.house!
                                            )
                                        }
                                    >
                                        Download the house file
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <aside className="v-about-box">
                    <h3>What a house file is checked for, and what a graph is</h3>
                    <p>
                        A <strong>house file</strong> is the blueprint as authored: surfaces as their
                        corners, openings, rooms by a point, recipes. It is checked for its shape,
                        opened into a model as a modeller opens it, and read as JSON-LD against the
                        ontology and the catalogue. The SHACL shapes are not run on it: they check a
                        blueprint graph with its <em>derived</em> parts — surface sides, zone
                        boundaries, edges, passages, an opening’s size on its surface — which a tool
                        adds when it exports the blueprint as RDF.
                    </p>
                    <p>
                        A <strong>TWB graph</strong> is that export (arch writes one; the case house’s
                        is <a href={`${BASE}ontology/examples/case-house.ttl`}>case-house.ttl</a>).
                        It is read with the ontology, the rules derive requirements and ways out, and
                        every shape of{' '}
                        <a href={`${BASE}reference/#shapes`}>twb-shapes.ttl</a> runs — SHACL Core and
                        SPARQL constraints, with results that match pyshacl’s.
                    </p>
                    <p>
                        From the command line: <code>npx @lbd-hackers/twb validate house.twb.jsonld</code>,
                        or <code>--rules</code> for a graph.
                    </p>
                </aside>
            </div>
        </section>
    );
}
