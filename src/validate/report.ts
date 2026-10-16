/**
 * What a validation says: findings in levels, each finding with a severity and, where it can,
 * where in the input it is. Plain data, so a report crosses from a Web Worker to the page as it
 * stands and is written to the CLI's `--json` as it stands.
 */

export type Severity = 'error' | 'warning' | 'info';

/**
 * The levels, in the order they run. A house file: `file` (its shape), `geometry` (opened into a
 * model), `vocabulary` (read as RDF, against the ontology and the catalogue), `shapes`. An IFC
 * file adds `import` before them. A graph: `parse`, `vocabulary`, `rules`, `shapes`.
 */
export type LevelName =
    | 'import'
    | 'file'
    | 'geometry'
    | 'vocabulary'
    | 'parse'
    | 'rules'
    | 'shapes';

/** A SHACL validation result behind a finding of the `shapes` level, its terms as text. */
export interface ShapeResult {
    /** The focus node: a prefixed name, `<iri>`, `_:id` or a literal in quotes. */
    focus: string;
    /** The property shape's path, prefixed: `twb:hasRecipe`, `^bot:hostsElement`. */
    path?: string;
    /** The shape: its IRI, or that of the named shape holding the anonymous one that failed. */
    shape: string;
    /** The constraint component's local name: `MinCountConstraintComponent`. */
    component: string;
    value?: string;
}

export interface Finding {
    level: LevelName;
    severity: Severity;
    message: string;
    /** A JSON path in the file (`surfaces[3].openings[0]`), or a node of the graph (`twb:Room`, `<iri>`). */
    where?: string;
    /** On the `shapes` level, the SHACL result the finding reports. */
    result?: ShapeResult;
}

export interface ReportLevel {
    name: LevelName;
    findings: Finding[];
    /** False when an earlier level failed so badly that this one could not run. */
    ran: boolean;
    ms: number;
}

/** What was validated. */
export type InputKind = 'house' | 'ifc' | 'graph';

export interface Report {
    kind: InputKind;
    levels: ReportLevel[];
    /** The input in numbers and words: format, faces, rooms, triples, … */
    summary: Record<string, string | number>;
    /** The triples the input made (a house file read as JSON-LD, or the graph). */
    triples?: number;
    counts: Record<Severity, number>;
    ms: number;
}

/** Whether the report has a finding of severity error: what fails a validation. */
export function hasErrors(report: Report): boolean {
    return report.counts.error > 0;
}

/** A level's findings, collected as they come, and timed. */
export class LevelBuilder {
    readonly findings: Finding[] = [];
    private readonly t0 = now();
    ran = true;

    constructor(readonly name: LevelName) {}

    add(severity: Severity, message: string, where?: string, result?: ShapeResult): void {
        this.findings.push({
            level: this.name,
            severity,
            message,
            ...(where !== undefined ? { where } : {}),
            ...(result ? { result } : {}),
        });
    }

    error(message: string, where?: string): void {
        this.add('error', message, where);
    }

    warning(message: string, where?: string): void {
        this.add('warning', message, where);
    }

    info(message: string, where?: string): void {
        this.add('info', message, where);
    }

    /** The level could not run: one info finding says why. */
    skip(why: string): ReportLevel {
        this.ran = false;
        this.info(`Not run: ${why}`);
        return this.done();
    }

    done(): ReportLevel {
        return {
            name: this.name,
            findings: this.findings,
            ran: this.ran,
            ms: Math.round(now() - this.t0),
        };
    }
}

/** A report from its levels. */
export function makeReport(
    kind: InputKind,
    levels: ReportLevel[],
    summary: Record<string, string | number>,
    t0: number,
    triples?: number
): Report {
    const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const level of levels) for (const f of level.findings) counts[f.severity]++;
    return {
        kind,
        levels,
        summary,
        ...(triples !== undefined ? { triples } : {}),
        counts,
        ms: Math.round(now() - t0),
    };
}

export function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const MARK: Record<Severity, string> = { error: 'error', warning: 'warn ', info: 'info ' };

/**
 * A report as lines of text, as the CLI prints it: per level its counts, then each finding with
 * where it is. `info: false` leaves the info findings out.
 */
export function formatReport(report: Report, options: { info?: boolean } = {}): string {
    const lines: string[] = [];
    const summary = Object.entries(report.summary)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
    lines.push(`${report.kind}: ${summary}`);
    for (const level of report.levels) {
        const n = (s: Severity) => level.findings.filter((f) => f.severity === s).length;
        const state = level.ran ? `${n('error')} errors, ${n('warning')} warnings` : 'not run';
        lines.push(`${level.name} — ${state} (${level.ms} ms)`);
        for (const f of level.findings) {
            if (f.severity === 'info' && options.info === false) continue;
            lines.push(`  ${MARK[f.severity]} ${f.where ? `${f.where}: ` : ''}${f.message}`);
        }
    }
    const c = report.counts;
    lines.push(
        `${c.error === 0 ? 'OK' : 'FAILED'}: ${c.error} errors, ${c.warning} warnings, ${c.info} notes (${report.ms} ms)`
    );
    return lines.join('\n');
}
