import { describe, expect, it } from 'vitest';
import { IfcModel } from './ifc-model';

/**
 * One stair flight, turning a quarter on its way up: its walking line an `'Axis'` polyline of
 * three points, in a placement 1000 east and 2000 north of the origin, turned a quarter.
 */
const FLIGHT = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    "FILE_NAME('flight.ifc','2026-10-21T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    '#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);',
    '#2=IFCUNITASSIGNMENT((#1));',
    '#3=IFCCARTESIANPOINT((0.,0.,0.));',
    '#4=IFCAXIS2PLACEMENT3D(#3,$,$);',
    "#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#4,$);",
    "#6=IFCPROJECT('p',$,'Trappe',$,$,$,$,(#5),#2);",
    '#7=IFCCARTESIANPOINT((1000.,2000.,0.));',
    '#8=IFCDIRECTION((0.,0.,1.));',
    '#9=IFCDIRECTION((0.,1.,0.));',
    '#10=IFCAXIS2PLACEMENT3D(#7,#8,#9);',
    '#11=IFCLOCALPLACEMENT($,#10);',
    '#12=IFCCARTESIANPOINT((0.,0.,0.));',
    '#13=IFCCARTESIANPOINT((2000.,0.,1400.));',
    '#14=IFCCARTESIANPOINT((2000.,1000.,2800.));',
    '#15=IFCPOLYLINE((#12,#13,#14));',
    "#16=IFCSHAPEREPRESENTATION(#5,'Axis','Curve3D',(#15));",
    '#17=IFCPRODUCTDEFINITIONSHAPE($,$,(#16));',
    "#18=IFCSTAIRFLIGHT('f',$,'Flight',$,$,#11,#17,$,$,$,$,$,$);",
    'ENDSEC;',
    'END-ISO-10303-21;',
].join('\n');

describe('IfcModel.axisPoints', () => {
    const m = IfcModel.read(FLIGHT);
    const flight = m.all('IFCSTAIRFLIGHT')[0]!;
    const round = (ps: { x: number; y: number; z: number }[] | null) =>
        ps?.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v)));

    it('gives every point of the axis in the world, round its turn', () => {
        // The placement's x is the world's y: 2000 along it is 2000 north, 1000 across it west.
        expect(round(m.axisPoints(flight))).toEqual([
            [1000, 2000, 0],
            [1000, 4000, 1400],
            [0, 4000, 2800],
        ]);
    });

    it('where axisOf gives only its ends', () => {
        expect(round(m.axisOf(flight))).toEqual([
            [1000, 2000, 0],
            [0, 4000, 2800],
        ]);
    });

    it('is null for a product with no axis', () => {
        expect(m.axisPoints(m.all('IFCPROJECT')[0]!)).toBeNull();
    });
});
