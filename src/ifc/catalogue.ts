/**
 * The little of arch's catalogue the IFC importer writes into a house file: the two architectural
 * expressions it picks from (a pitched roof's and a flat roof's), the opening finishes they set,
 * the default thickness of each material it maps a layer to, and the names of the heavy floor and
 * roof structures it reports. The ids are the catalogue's (`ontology/twb-catalogue.ttl`, under
 * `https://w3id.org/twb/catalogue/arch#`), so a file the importer writes opens in any tool that
 * reads the catalogue.
 *
 * Pure data.
 */

import type { OpeningKind } from '../surfacekit/model';

export interface ExpressionDef {
    id: string;
    label: string;
    /** The roof coverings it can take; the first is its default. */
    roofs: readonly string[];
    /** Its standard finish round the openings. */
    openings: string;
    /** The eave and verge joint standards it sets. */
    eave: string;
    verge: string;
}

const EXPRESSIONS: readonly ExpressionDef[] = [
    {
        id: 'overhang-barge',
        label: 'Overhang and barge board',
        roofs: ['tiles', 'zinc', 'battens', 'felt', 'green'],
        openings: 'frame-boards',
        eave: 'miter',
        verge: 'miter',
    },
    {
        id: 'flat-roof',
        label: 'Flat roof with parapet',
        roofs: ['felt', 'green'],
        openings: 'sill-flashing',
        eave: 'parapet',
        verge: 'miter',
    },
];

export function expressionDef(id: string): ExpressionDef | null {
    return EXPRESSIONS.find((d) => d.id === id) ?? null;
}

/** The kinds of opening a standard finish is kept for. */
export const DETAILED_OPENING_KINDS: readonly OpeningKind[] = ['window', 'door', 'garage-door'];

/** Whether an opening of `kind` can take the finish `detail`: a sill flashing is a window's only. */
export function openingTakesDetail(kind: OpeningKind, detail: string): boolean {
    return (
        ['plain', 'sill-flashing', 'frame-boards', 'head-sill-boards'].includes(detail) &&
        (detail !== 'sill-flashing' || kind === 'window')
    );
}

/** A material's thickness when a layer gives none, mm. */
const DEFAULT_THICKNESS_MM: Readonly<Record<string, number>> = {
    'hollow-core': 220,
    'air-ventilated': 25,
    'air-still': 25,
    'green-roof': 80,
    zinc: 1,
    roofing: 20,
    'roofing-felt': 8,
    'mw-34': 195,
    'eps-34': 300,
    'wood-fibre': 195,
    cellulose: 195,
    'mw-37': 195,
    'gypsum-wind': 9,
    'vapour-brake': 0.2,
    'vapour-barrier': 0.2,
    'radon-membrane': 0.4,
    'roof-underlay': 1,
    'wind-membrane': 0.5,
    screed: 20,
    'aerated-concrete': 100,
    brick: 108,
    'concrete-block': 190,
    concrete: 100,
    softwood: 22,
    gypsum: 13,
    osb: 15,
    plywood: 15,
    'wood-fibre-board': 35,
    'facade-sheet': 12,
    cladding: 22,
    floorboards: 22,
};

export function defaultThicknessMm(materialId: string): number {
    return DEFAULT_THICKNESS_MM[materialId] ?? 15;
}

/** What a floor between storeys, or a roof, is carried by. */
export type FloorStructure = 'timber' | 'cast-concrete' | 'hollow-core';
export type RoofStructure = FloorStructure;

export const FLOOR_STRUCTURE_LABELS: Readonly<Record<FloorStructure, string>> = {
    timber: 'Timber joists',
    'cast-concrete': 'Cast concrete',
    'hollow-core': 'Hollow-core slabs',
};

export const ROOF_STRUCTURE_LABELS: Readonly<Record<RoofStructure, string>> = {
    timber: 'Timber',
    'cast-concrete': 'Cast concrete',
    'hollow-core': 'Hollow-core slabs',
};
