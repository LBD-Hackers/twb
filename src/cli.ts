#!/usr/bin/env node
/**
 * `twb`: house files and IFC from the command line.
 *
 *     twb import-ifc model.ifc [-o house.twb.jsonld] [--name "Villa Nord"]
 *     twb check house.twb.jsonld
 *     twb convert house.json [-o house.twb.jsonld]
 *     twb validate <file> [--rules] [--with <data.ttl>]… [--json]
 *     twb context
 *
 * `import-ifc` writes the house file to `-o` (or standard output) and the report to standard
 * error. `check` opens a house file as a tool would and lists what it had wrong; it exits 1 if
 * anything. `convert` writes an `arch/1` (or `twb/1`) file as `twb/1`. `context` prints the
 * house file's JSON-LD context.
 *
 * `validate` checks a house file, an IFC file or a TWB graph against the ontology, its catalogue
 * and its shapes (`src/validate`), with the ontology this package ships (`ontology/`). A graph's
 * rules are applied with `--rules`; a blueprint's adjacency rules kept beside it as
 * `<name>-rules.ttl` and `<name>-use-rules.ttl` (as the case house keeps them) are loaded with it,
 * and `--with` adds any other file. It exits 1 on a finding of severity error. It needs
 * `oxigraph`, an optional peer dependency, and loads it only when it runs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ifcImportSummary, ifcToHouse } from './ifc';
import {
    TWB_HOUSE_CONTEXT,
    fromTwbHouse,
    loadHouse,
    toTwbHouse,
    type HouseFile,
} from './house';
import type { Oxigraph } from './validate/oxigraph';

const USAGE = `Usage:
  twb import-ifc <model.ifc> [-o <house.twb.jsonld>] [--name <project name>]
  twb check <house.twb.jsonld>
  twb convert <house.json> [-o <house.twb.jsonld>]
  twb validate <file> [--rules] [--with <data.ttl>]... [--json]
  twb context`;

function option(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
}

function write(text: string, to: string | undefined): void {
    if (to) writeFileSync(to, text);
    else process.stdout.write(text);
}

async function main(argv: string[]): Promise<number> {
    const [command, ...args] = argv;
    switch (command) {
        case 'import-ifc': {
            const out = option(args, '-o');
            const name = option(args, '--name');
            const input = args[0];
            if (!input) break;
            const { house, report } = ifcToHouse(
                readFileSync(input, 'utf8'),
                name ? { name } : {}
            );
            write(JSON.stringify(house, null, 2) + '\n', out);
            process.stderr.write(ifcImportSummary(report).join('\n') + '\n');
            return 0;
        }
        case 'check': {
            const input = args[0];
            if (!input) break;
            const house = loadHouse(readFileSync(input, 'utf8'));
            const s = house.store;
            process.stdout.write(
                `${house.parsed.format ?? 'no format'}: ${s.surfaces().length} faces, ` +
                    `${s.storeys().length} storeys, ${house.zones.zones().length} rooms, ` +
                    `${house.interiorFaces} partition faces, ${house.interiorOpenings} doors in partitions.\n`
            );
            for (const p of house.problems) process.stdout.write(`- ${p}\n`);
            return house.problems.length > 0 ? 1 : 0;
        }
        case 'convert': {
            const out = option(args, '-o');
            const input = args[0];
            if (!input) break;
            const json = JSON.parse(readFileSync(input, 'utf8')) as Record<string, unknown>;
            const arch1 = json['format'] === 'twb/1' ? fromTwbHouse(json) : json;
            write(JSON.stringify(toTwbHouse(arch1 as unknown as HouseFile), null, 2) + '\n', out);
            return 0;
        }
        case 'context':
            write(JSON.stringify({ '@context': TWB_HOUSE_CONTEXT }, null, 2) + '\n', undefined);
            return 0;
        case 'validate':
            return validateCommand(args);
    }
    process.stderr.write(USAGE + '\n');
    return 2;
}

/** `twb validate`: the file validated as what it is, the report printed, 1 on any error. */
async function validateCommand(args: string[]): Promise<number> {
    const json = flag(args, '--json');
    const rules = flag(args, '--rules');
    const extra: string[] = [];
    for (let w = option(args, '--with'); w !== undefined; w = option(args, '--with')) extra.push(w);
    const input = args[0];
    if (!input) return usage();

    let ox: Oxigraph;
    try {
        ox = (await import('oxigraph')) as unknown as Oxigraph;
    } catch {
        process.stderr.write('twb validate needs oxigraph: npm install oxigraph\n');
        return 2;
    }
    const { validate, formatReport, detectInput } = await import('./validate');
    const { loadOntologySources } = await import('./validate/node');

    const text = readFileSync(input, 'utf8');
    const detected = detectInput(input, text);
    // A blueprint's adjacency rules, kept beside it as the case house keeps them.
    const base = input.replace(/\.(ttl|nt)$/i, '');
    const siblings =
        detected.kind === 'graph' && base !== input
            ? [`${base}-rules.ttl`, `${base}-use-rules.ttl`].filter(
                  (f) => existsSync(f) && !extra.includes(f)
              )
            : [];
    const withFiles = [...siblings, ...extra].map((f) => {
        const t = readFileSync(f, 'utf8');
        const d = detectInput(f, t);
        return { name: basename(f), text: t, format: d.kind === 'graph' ? d.format : ('turtle' as const) };
    });
    const report = validate(basename(input), text, loadOntologySources(), ox, {
        rules,
        with: withFiles,
    });
    if (!report) {
        process.stderr.write(
            `${input}: not validated: ${detected.kind === 'unknown' ? detected.reason : 'unknown input'}.\n`
        );
        return 2;
    }
    process.stdout.write(
        json ? JSON.stringify(report, null, 2) + '\n' : `${input}\n${formatReport(report)}\n`
    );
    return report.counts.error > 0 ? 1 : 0;
}

function flag(args: string[], name: string): boolean {
    const i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
}

function usage(): number {
    process.stderr.write(USAGE + '\n');
    return 2;
}

main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (e: unknown) => {
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 2;
    }
);
