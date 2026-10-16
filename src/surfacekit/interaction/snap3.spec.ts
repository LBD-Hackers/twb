import { describe, expect, it } from 'vitest';
import { snapOnPlane, type SnapContext } from './snap3';
import { isModularMm } from '../grid';

function ctx(overrides: Partial<SnapContext> = {}): SnapContext {
    return { rings: [], toleranceMm: 150, subPitchMm: 600, ...overrides };
}

const SQUARE = {
    pointsUv: [
        { x: 0, y: 0 },
        { x: 2400, y: 0 },
        { x: 2400, y: 2400 },
        { x: 0, y: 2400 },
    ],
    closed: true,
};

describe('grid fallback', () => {
    it('lands an open-space click on the module grid', () => {
        const r = snapOnPlane({ x: 1250, y: 1180 }, ctx());
        expect(r.kind).toBe('module-grid');
        expect(r.pointUv).toEqual({ x: 1200, y: 1200 });
    });

    it('falls to the sub-grid when the cursor aims between modules', () => {
        const r = snapOnPlane({ x: 1810, y: 610 }, ctx());
        expect(r.kind).toBe('sub-grid');
        expect(r.pointUv).toEqual({ x: 1800, y: 600 });
    });

    it('never yields a non-modular coordinate from open space', () => {
        // The point of the whole module: a raw float pointer position must not reach the model.
        for (const p of [
            { x: 1337, y: 991 },
            { x: 47, y: 4213 },
            { x: 8888, y: 123 },
        ]) {
            const r = snapOnPlane(p, ctx());
            expect(r.pointUv.x % 200).toBe(0);
            expect(r.pointUv.y % 200).toBe(0);
        }
    });
});

describe('snap priority', () => {
    it('prefers a vertex over the edge it sits on', () => {
        // The cursor is nearer the edge (by construction an edge's nearest point is never
        // farther than its endpoints), so without tiering the vertex would be unreachable.
        const r = snapOnPlane({ x: 40, y: 30 }, ctx({ rings: [SQUARE] }));
        expect(r.kind).toBe('vertex');
        expect(r.pointUv).toEqual({ x: 0, y: 0 });
    });

    it('prefers a midpoint over the edge it sits on', () => {
        const r = snapOnPlane({ x: 1200, y: 40 }, ctx({ rings: [SQUARE] }));
        expect(r.kind).toBe('midpoint');
        expect(r.pointUv).toEqual({ x: 1200, y: 0 });
    });

    it('snaps to an edge when no more specific candidate is near', () => {
        const r = snapOnPlane({ x: 600, y: 40 }, ctx({ rings: [SQUARE] }));
        expect(r.kind).toBe('edge');
        expect(r.pointUv.y).toBe(0);
    });

    it('walks along an axis-aligned edge in grid steps, so a split point stays modular', () => {
        // 700 along the bottom edge is on the edge but not on the grid; the snap keeps it on
        // the edge and moves it to the nearest 600 step. Off-grid along a diagonal is allowed.
        const r = snapOnPlane({ x: 700, y: 40 }, ctx({ rings: [SQUARE] }));
        expect(r.kind).toBe('edge');
        expect(r.pointUv).toEqual({ x: 600, y: 0 });
        const diagonal = {
            pointsUv: [
                { x: 0, y: 0 },
                { x: 2400, y: 2400 },
                { x: 0, y: 2400 },
            ],
            closed: true,
        };
        const d = snapOnPlane({ x: 740, y: 660 }, ctx({ rings: [diagonal] }));
        expect(d.kind).toBe('edge');
        expect(d.pointUv.x).toBeCloseTo(700, 6);
    });

    it('does not quantise along an edge with the grid off', () => {
        const r = snapOnPlane({ x: 700, y: 40 }, ctx({ rings: [SQUARE], snapToGrid: false }));
        expect(r.kind).toBe('edge');
        expect(r.pointUv).toEqual({ x: 700, y: 0 });
    });

    it('reports a genuine interior crossing as an intersection', () => {
        const cross: SnapContext = ctx({
            rings: [
                {
                    pointsUv: [
                        { x: 0, y: 0 },
                        { x: 2400, y: 2400 },
                    ],
                    closed: false,
                },
                {
                    pointsUv: [
                        { x: 0, y: 2400 },
                        { x: 2400, y: 0 },
                    ],
                    closed: false,
                },
            ],
        });
        const r = snapOnPlane({ x: 1220, y: 1180 }, cross);
        expect(r.kind).toBe('intersection');
        expect(r.pointUv.x).toBeCloseTo(1200, 6);
        expect(r.pointUv.y).toBeCloseTo(1200, 6);
    });

    it('does not report two edges merely sharing a vertex as an intersection', () => {
        // That is what the vertex candidate is for; only an interior crossing counts.
        const r = snapOnPlane({ x: 30, y: 30 }, ctx({ rings: [SQUARE] }));
        expect(r.kind).toBe('vertex');
    });
});

describe('axis lock', () => {
    const from = { x: 0, y: 0 };

    it('engages within a few degrees of an axis and flattens the drift', () => {
        const r = snapOnPlane({ x: 2400, y: 60 }, ctx({ lastPointUv: from }));
        expect(r.kind).toBe('axis');
        expect(r.pointUv.y).toBeCloseTo(0, 6);
    });

    it('does not engage at a clearly off-axis angle', () => {
        const r = snapOnPlane({ x: 2400, y: 1000 }, ctx({ lastPointUv: from }));
        expect(r.kind).not.toBe('axis');
    });

    it('engages unconditionally when forced', () => {
        const r = snapOnPlane(
            { x: 2400, y: 1000 },
            ctx({ lastPointUv: from, forceAxisLock: true })
        );
        expect(r.kind).toBe('axis');
    });

    it('quantises the distance along the lock onto the modular pitch', () => {
        // An axis-locked point still has a free coordinate along the ray. Leaving it
        // unsnapped is the one way a non-modular length could enter the model.
        const r = snapOnPlane({ x: 2470, y: 20 }, ctx({ lastPointUv: from }));
        expect(r.kind).toBe('axis');
        expect(isModularMm(Math.hypot(r.pointUv.x, r.pointUv.y))).toBe(true);
        expect(r.pointUv.x).toBeCloseTo(2400, 6);
    });

    it('does not lock onto 45 degrees — only the axes', () => {
        const r = snapOnPlane({ x: 1700, y: 1680 }, ctx({ lastPointUv: from }));
        expect(r.kind).not.toBe('axis');
    });
});

describe('grid switched off', () => {
    const free = (overrides: Partial<SnapContext> = {}) => ctx({ snapToGrid: false, ...overrides });

    it('leaves an open-space point exactly where the cursor is', () => {
        const r = snapOnPlane({ x: 2437, y: 913 }, free());
        expect(r.kind).toBe('free');
        expect(r.pointUv).toEqual({ x: 2437, y: 913 });
    });

    it('still snaps to an existing vertex — the grid is off, not the magnets', () => {
        const r = snapOnPlane({ x: 2450, y: 40 }, free({ rings: [SQUARE] }));
        expect(r.kind).toBe('vertex');
        expect(r.pointUv).toEqual({ x: 2400, y: 0 });
    });

    it('still locks to an axis, but no longer quantises the distance along it', () => {
        // The whole point of the toggle: a 2470 mm wall is a dimension the module cannot
        // express, and with the grid off it has to survive the lock intact.
        const r = snapOnPlane({ x: 2470, y: 20 }, free({ lastPointUv: { x: 0, y: 0 } }));
        expect(r.kind).toBe('axis');
        expect(r.pointUv.x).toBeCloseTo(2470, 6);
        expect(r.pointUv.y).toBeCloseTo(0, 6);
    });
});

describe('lock direction reporting', () => {
    it('reports the locked direction so the caller can name the world axis', () => {
        const r = snapOnPlane({ x: 20, y: 2400 }, ctx({ lastPointUv: { x: 0, y: 0 } }));
        expect(r.kind).toBe('axis');
        expect(r.lockDirUv?.x).toBeCloseTo(0, 6);
        expect(r.lockDirUv?.y).toBeCloseTo(1, 6);
    });

    it('reports null when no lock engaged', () => {
        expect(snapOnPlane({ x: 1190, y: 10 }, ctx()).lockDirUv).toBeNull();
    });
});

describe('from-point inference', () => {
    const P = { x: 0, y: 0 };
    const AXES = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
    ];
    const armed = (overrides: Partial<SnapContext> = {}) =>
        ctx({ fromPoint: { pointUv: P, dirsUv: AXES }, ...overrides });

    it('pulls the cursor onto a line through the armed point when it is near one', () => {
        // 70 mm off the vertical through P, within the 150 mm tolerance.
        const r = snapOnPlane({ x: 70, y: 3010 }, armed());
        expect(r.kind).toBe('from-point');
        expect(r.pointUv.x).toBeCloseTo(0, 6);
        expect(r.fromPointUv).toEqual(P);
        expect(r.lockDirUv).toBeNull();
    });

    it('quantises the distance along the line with the grid on, and not with it off', () => {
        expect(snapOnPlane({ x: 70, y: 3010 }, armed()).pointUv.y).toBe(3000);
        expect(snapOnPlane({ x: 70, y: 3010 }, armed({ snapToGrid: false })).pointUv.y).toBeCloseTo(
            3010,
            6
        );
    });

    it('does nothing when the cursor is well off every line', () => {
        const r = snapOnPlane({ x: 1250, y: 1180 }, armed());
        expect(r.kind).toBe('module-grid');
        expect(r.fromPointUv).toBeNull();
    });

    it('crossed with the axis lock, pins the cursor to where the two lines meet', () => {
        // The rectangle case: corners A(0,0) B(4800,0) C(4800,3600) placed, A armed. From C
        // the cursor heads west along the lock; the vertical through A crosses it at D(0,3600).
        // The crossing is taken whole — not quantised — even from a cursor 70 mm off both.
        const r = snapOnPlane(
            { x: 60, y: 3660 },
            armed({ lastPointUv: { x: 4800, y: 3600 }, subPitchMm: 0 })
        );
        expect(r.kind).toBe('from-point');
        expect(r.pointUv.x).toBeCloseTo(0, 6);
        expect(r.pointUv.y).toBeCloseTo(3600, 6);
        expect(r.fromPointUv).toEqual(P);
        expect(r.lockDirUv?.x).toBeCloseTo(-1, 6);
        expect(r.lockDirUv?.y).toBeCloseTo(0, 6);
    });

    it('does not take a crossing of two nearly parallel lines — the projection stands', () => {
        // Lock from (0, 3600) heading east, from-point line along x through P: parallel. The
        // cursor still rides the from-line, but no lock is claimed for it.
        const r = snapOnPlane(
            { x: 2400, y: 40 },
            ctx({
                fromPoint: { pointUv: P, dirsUv: [{ x: 1, y: 0 }] },
                lastPointUv: { x: 0, y: 3600 },
            })
        );
        expect(r.kind).toBe('from-point');
        expect(r.pointUv.y).toBeCloseTo(0, 6);
        expect(r.lockDirUv).toBeNull();
    });

    it('offers the perpendicular to an edge at its open end', () => {
        // A guide from (0,0) to (2400,1800): its perpendicular at P is (-0.6, 0.8).
        const r = snapOnPlane(
            { x: -1200, y: 1600 },
            ctx({ fromPoint: { pointUv: P, dirsUv: [{ x: -0.6, y: 0.8 }] }, snapToGrid: false })
        );
        expect(r.kind).toBe('from-point');
        expect(r.pointUv.x * 0.8 + r.pointUv.y * 0.6).toBeCloseTo(0, 6);
    });

    it('loses to a real point of the model, and does nothing on the armed point itself', () => {
        const r = snapOnPlane({ x: 2380, y: 20 }, armed({ rings: [SQUARE] }));
        expect(r.kind).toBe('vertex');
        expect(r.fromPointUv).toBeNull();
        const onP = snapOnPlane({ x: 20, y: 20 }, armed({ rings: [SQUARE] }));
        expect(onP.kind).toBe('vertex');
        expect(onP.pointUv).toEqual(P);
    });
});
