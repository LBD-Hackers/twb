import { describe, expect, it, vi } from 'vitest';
import { RectangleTool } from './rectangle-tool';
import { groundPlane, verticalPlaneThrough } from './working-plane';
import type { Point3Mm } from '../core';

const GROUND = groundPlane(0);
const WALL = verticalPlaneThrough({ x: 0, y: 0, z: 0 }, { x: 7200, y: 0, z: 0 })!;

function tool(commit: (ring: readonly Point3Mm[]) => boolean = () => true) {
    const onCommit = vi.fn(commit);
    const t = new RectangleTool({ onCommit, onChange: () => {} });
    t.start();
    return { t, onCommit };
}

describe('RectangleTool', () => {
    it('makes a rectangle from two opposite corners on the ground', () => {
        const { t, onCommit } = tool();
        t.click({ x: 0, y: 0, z: 0 }, GROUND);
        expect(t.isArmed).toBe(true);
        t.click({ x: 4800, y: 3600, z: 0 }, GROUND);
        expect(onCommit).toHaveBeenCalledOnce();
        expect(onCommit.mock.calls[0]![0]).toEqual([
            { x: 0, y: 0, z: 0 },
            { x: 4800, y: 0, z: 0 },
            { x: 4800, y: 3600, z: 0 },
            { x: 0, y: 3600, z: 0 },
        ]);
        expect(t.isArmed).toBe(false);
    });

    it('builds the rectangle in the plane it is given — up a wall, not across the ground', () => {
        const { t, onCommit } = tool();
        t.click({ x: 1200, y: 0, z: 900 }, WALL);
        t.click({ x: 2400, y: 0, z: 2100 }, WALL);
        expect(onCommit.mock.calls[0]![0]).toEqual([
            { x: 1200, y: 0, z: 900 },
            { x: 2400, y: 0, z: 900 },
            { x: 2400, y: 0, z: 2100 },
            { x: 1200, y: 0, z: 2100 },
        ]);
    });

    it('ignores a second corner that would make the rectangle too thin', () => {
        const { t, onCommit } = tool();
        t.click({ x: 0, y: 0, z: 0 }, GROUND);
        t.click({ x: 4800, y: 40, z: 0 }, GROUND);
        expect(onCommit).not.toHaveBeenCalled();
        expect(t.isArmed).toBe(true);
        expect(t.previewRing({ x: 4800, y: 40, z: 0 }, GROUND)).toBeNull();
    });

    it('keeps the anchor when the commit is rejected, and drops it on popVertex', () => {
        const { t } = tool(() => false);
        t.click({ x: 0, y: 0, z: 0 }, GROUND);
        t.click({ x: 2400, y: 2400, z: 0 }, GROUND);
        expect(t.isArmed).toBe(true);
        t.popVertex();
        expect(t.isArmed).toBe(false);
    });
});

describe('RectangleTool.typedCorner', () => {
    it('puts the corner width,depth from the anchor on the cursor’s side', () => {
        const { t } = tool();
        t.click({ x: 1200, y: 1200, z: 0 }, GROUND);
        expect(t.typedCorner({ x: 1300, y: 1250, z: 0 }, GROUND, 4800, 3600)).toEqual({
            x: 6000,
            y: 4800,
            z: 0,
        });
        expect(t.typedCorner({ x: 0, y: 0, z: 0 }, GROUND, 4800, 3600)).toEqual({
            x: -3600,
            y: -2400,
            z: 0,
        });
    });

    it('keeps the cursor’s dimension where none was typed', () => {
        const { t } = tool();
        t.click({ x: 0, y: 0, z: 0 }, GROUND);
        expect(t.typedCorner({ x: 900, y: 700, z: 0 }, GROUND, 4800, null)).toEqual({
            x: 4800,
            y: 700,
            z: 0,
        });
        expect(t.typedCorner({ x: 900, y: 700, z: 0 }, GROUND, null, 3600)).toEqual({
            x: 900,
            y: 3600,
            z: 0,
        });
    });

    it('works in a wall’s frame, where depth is up', () => {
        const { t } = tool();
        t.click({ x: 2400, y: 0, z: 900 }, WALL);
        expect(t.typedCorner({ x: 2500, y: 0, z: 1000 }, WALL, 1200, 1200)).toEqual({
            x: 3600,
            y: 0,
            z: 2100,
        });
    });

    it('is null before the first corner', () => {
        const { t } = tool();
        expect(t.typedCorner({ x: 0, y: 0, z: 0 }, GROUND, 1, 1)).toBeNull();
    });
});
