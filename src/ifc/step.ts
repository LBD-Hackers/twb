/**
 * A STEP physical file (ISO 10303-21) read into its entities: what an `.ifc` is. Every
 * `#12=IFCTHING(a,b,c);` becomes `{ id: 12, type: 'IFCTHING', args: [a, b, c] }`, with each
 * argument read into a plain value:
 *
 * - a number (`3.`, `-1.25`, `1.E-009`) is a `number`;
 * - a string (`'Level 1'`) is a `string`, with `''` and the `\X\`, `\X2\…\X0\` and `\S\`
 *   escapes decoded;
 * - a reference (`#33`) is a `StepRef`, an enumeration (`.ELEMENT.`) a `StepEnum`;
 * - `$` (unset) and `*` (derived) are `null`;
 * - a list (`(#1,#2)`) is an array;
 * - a typed value (`IFCLABEL('x')`, `IFCLENGTHMEASURE(0.2)`) is a `StepTyped`.
 *
 * Nothing here knows IFC: `ifc-model.ts` reads the entities as IFC. Pure, no DOM, so the same
 * code reads a file in a browser, a worker or Node.
 */

export interface StepRef {
    readonly ref: number;
}

export interface StepEnum {
    readonly enum: string;
}

export interface StepTyped {
    readonly typed: string;
    readonly value: StepValue;
}

export type StepValue =
    number | string | boolean | null | StepRef | StepEnum | StepTyped | StepValue[];

export interface StepEntity {
    readonly id: number;
    /** Upper case, as the file writes it: `IFCWALLSTANDARDCASE`. */
    readonly type: string;
    readonly args: readonly StepValue[];
}

export interface StepFile {
    /** `FILE_SCHEMA`'s first name: `IFC2X3`, `IFC4`, `IFC4X3_ADD2`. */
    readonly schema: string;
    readonly entities: ReadonlyMap<number, StepEntity>;
}

export function isRef(v: unknown): v is StepRef {
    return typeof v === 'object' && v !== null && 'ref' in v;
}

export function isEnum(v: unknown): v is StepEnum {
    return typeof v === 'object' && v !== null && 'enum' in v;
}

export function isTyped(v: unknown): v is StepTyped {
    return typeof v === 'object' && v !== null && 'typed' in v;
}

/** Reads a whole STEP file. Throws on a file that is not one; skips a line it cannot read. */
export function readStep(text: string): StepFile {
    if (!/^\s*ISO-10303-21\s*;/.test(text)) {
        throw new Error('Not an IFC file: it does not start with ISO-10303-21.');
    }
    const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(text);
    const schema = (schemaMatch?.[1] ?? '').toUpperCase();
    const dataAt = text.search(/\bDATA\s*;/);
    if (dataAt < 0) throw new Error('Not an IFC file: it has no DATA section.');

    const entities = new Map<number, StepEntity>();
    const reader = new Reader(text, dataAt + text.slice(dataAt).indexOf(';') + 1);
    for (;;) {
        reader.skipSpace();
        if (reader.done() || reader.startsWith('ENDSEC')) break;
        if (reader.peek() !== '#') {
            reader.skipStatement();
            continue;
        }
        const start = reader.pos;
        try {
            const entity = reader.entity();
            if (entity) entities.set(entity.id, entity);
        } catch {
            reader.pos = start;
            reader.skipStatement();
        }
    }
    return { schema, entities };
}

class Reader {
    constructor(
        private readonly s: string,
        public pos: number
    ) {}

    done(): boolean {
        return this.pos >= this.s.length;
    }

    peek(): string {
        return this.s[this.pos] ?? '';
    }

    startsWith(word: string): boolean {
        return this.s.startsWith(word, this.pos);
    }

    skipSpace(): void {
        const s = this.s;
        for (;;) {
            const c = s.charCodeAt(this.pos);
            if (c === 32 || c === 10 || c === 13 || c === 9) {
                this.pos++;
            } else if (c === 47 && s.charCodeAt(this.pos + 1) === 42) {
                // A /* comment */.
                const end = s.indexOf('*/', this.pos + 2);
                this.pos = end < 0 ? s.length : end + 2;
            } else return;
        }
    }

    /** Past the next `;` that is not inside a string. */
    skipStatement(): void {
        const s = this.s;
        let quoted = false;
        while (this.pos < s.length) {
            const c = s[this.pos++];
            if (c === "'") quoted = !quoted;
            else if (c === ';' && !quoted) return;
        }
    }

    entity(): StepEntity | null {
        this.pos++; // '#'
        const id = this.integer();
        this.skipSpace();
        if (this.s[this.pos++] !== '=') throw new Error('expected =');
        this.skipSpace();
        const type = this.keyword();
        this.skipSpace();
        if (this.s[this.pos] !== '(') throw new Error('expected (');
        const args = this.list();
        this.skipSpace();
        if (this.s[this.pos] === ';') this.pos++;
        return { id, type, args };
    }

    private integer(): number {
        const start = this.pos;
        while (/[0-9]/.test(this.s[this.pos] ?? '')) this.pos++;
        return Number(this.s.slice(start, this.pos));
    }

    private keyword(): string {
        const start = this.pos;
        while (/[A-Za-z0-9_]/.test(this.s[this.pos] ?? '')) this.pos++;
        return this.s.slice(start, this.pos).toUpperCase();
    }

    private list(): StepValue[] {
        this.pos++; // '('
        const out: StepValue[] = [];
        this.skipSpace();
        if (this.s[this.pos] === ')') {
            this.pos++;
            return out;
        }
        for (;;) {
            this.skipSpace();
            out.push(this.value());
            this.skipSpace();
            const c = this.s[this.pos++];
            if (c === ')') return out;
            if (c !== ',') throw new Error(`expected , or ) at ${this.pos}`);
        }
    }

    private value(): StepValue {
        const c = this.s[this.pos];
        if (c === '$' || c === '*') {
            this.pos++;
            return null;
        }
        if (c === '#') {
            this.pos++;
            return { ref: this.integer() };
        }
        if (c === "'") return this.string();
        if (c === '(') return this.list();
        if (c === '.') {
            const end = this.s.indexOf('.', this.pos + 1);
            const word = this.s.slice(this.pos + 1, end).toUpperCase();
            this.pos = end + 1;
            if (word === 'T') return true;
            if (word === 'F') return false;
            return { enum: word };
        }
        if (c === '"') {
            // A binary: kept as its hex text.
            const end = this.s.indexOf('"', this.pos + 1);
            const hex = this.s.slice(this.pos + 1, end);
            this.pos = end + 1;
            return hex;
        }
        if (/[A-Za-z]/.test(c ?? '')) {
            const typed = this.keyword();
            this.skipSpace();
            const inner = this.list();
            return { typed, value: inner.length === 1 ? inner[0]! : inner };
        }
        const start = this.pos;
        while (/[-+0-9.eE]/.test(this.s[this.pos] ?? '')) this.pos++;
        const n = Number(this.s.slice(start, this.pos));
        if (this.pos === start || !Number.isFinite(n)) throw new Error(`bad value at ${start}`);
        return n;
    }

    private string(): string {
        const s = this.s;
        let raw = '';
        this.pos++; // opening quote
        for (;;) {
            const end = s.indexOf("'", this.pos);
            if (end < 0) throw new Error('unterminated string');
            raw += s.slice(this.pos, end);
            this.pos = end + 1;
            if (s[this.pos] === "'") {
                raw += "'";
                this.pos++;
                continue;
            }
            return decodeStepString(raw);
        }
    }
}

/** The ISO 10303-21 escapes: `\X2\00E6\X0\` (UTF-16), `\X\E6` (ISO 8859-1), `\S\f` (high half). */
export function decodeStepString(raw: string): string {
    if (!raw.includes('\\')) return raw;
    return raw
        .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
            let out = '';
            for (let i = 0; i + 4 <= hex.length; i += 4) {
                out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
            }
            return out;
        })
        .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
            let out = '';
            for (let i = 0; i + 8 <= hex.length; i += 8) {
                out += String.fromCodePoint(parseInt(hex.slice(i, i + 8), 16));
            }
            return out;
        })
        .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
        )
        .replace(/\\S\\(.)/g, (_, ch: string) => String.fromCharCode(ch.charCodeAt(0) + 128))
        .replace(/\\\\/g, '\\');
}
