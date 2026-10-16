import { describe, expect, it } from 'vitest';
import { decodeStepString, isEnum, isRef, isTyped, readStep } from './step';

const file = (data: string) =>
    `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${data}\nENDSEC;\nEND-ISO-10303-21;\n`;

describe('reading a STEP file', () => {
    it('reads every kind of argument', () => {
        const step = readStep(
            file("#1=IFCTHING('it''s',#2,.ELEMENT.,$,*,(1.,-2.5,1.E-3),IFCLABEL('x'),.T.,(#3,#4));")
        );
        expect(step.schema).toBe('IFC4');
        const e = step.entities.get(1)!;
        expect(e.type).toBe('IFCTHING');
        const [s, ref, en, unset, derived, list, typed, bool, refs] = e.args;
        expect(s).toBe("it's");
        expect(isRef(ref) && ref.ref).toBe(2);
        expect(isEnum(en) && en.enum).toBe('ELEMENT');
        expect(unset).toBeNull();
        expect(derived).toBeNull();
        expect(list).toEqual([1, -2.5, 0.001]);
        expect(isTyped(typed) && typed.typed === 'IFCLABEL' && typed.value).toBe('x');
        expect(bool).toBe(true);
        expect(Array.isArray(refs) && refs.length).toBe(2);
    });

    it('reads an entity over several lines, and skips one it cannot', () => {
        const step = readStep(file("#1=IFCA(1,\n  2);\n#2=IFCB(';' ,§);\n#3=IFCC('ok');"));
        expect(step.entities.get(1)!.args).toEqual([1, 2]);
        expect(step.entities.has(2)).toBe(false);
        expect(step.entities.get(3)!.args).toEqual(['ok']);
    });

    it('decodes the escapes', () => {
        expect(decodeStepString('Bryggers \\X2\\00E6\\X0\\')).toBe('Bryggers æ');
        expect(decodeStepString('K\\X\\F8kken')).toBe('Køkken');
        expect(decodeStepString('\\S\\x')).toBe('ø');
    });

    it('refuses a file that is not STEP', () => {
        expect(() => readStep('{"format": "twb/1"}')).toThrow(/Not an IFC file/);
    });
});
