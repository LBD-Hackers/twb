#!/usr/bin/env node
/**
 * `twb`: house files and IFC from the command line.
 *
 *     twb import-ifc model.ifc [-o house.twb.jsonld] [--name "Villa Nord"]
 *     twb check house.twb.jsonld
 *     twb convert house.json [-o house.twb.jsonld]
 *     twb context
 *
 * `import-ifc` writes the house file to `-o` (or standard output) and the report to standard
 * error. `check` opens a house file as a tool would and lists what it had wrong; it exits 1 if
 * anything. `convert` writes an `arch/1` (or `twb/1`) file as `twb/1`. `context` prints the
 * house file's JSON-LD context.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { ifcImportSummary, ifcToHouse } from './ifc';
import {
    TWB_HOUSE_CONTEXT,
    fromTwbHouse,
    loadHouse,
    toTwbHouse,
    type HouseFile,
} from './house';

const USAGE = `Usage:
  twb import-ifc <model.ifc> [-o <house.twb.jsonld>] [--name <project name>]
  twb check <house.twb.jsonld>
  twb convert <house.json> [-o <house.twb.jsonld>]
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

function main(argv: string[]): number {
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
    }
    process.stderr.write(USAGE + '\n');
    return 2;
}

process.exitCode = main(process.argv.slice(2));
