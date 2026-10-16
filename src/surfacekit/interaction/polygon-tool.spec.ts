import { describe, expect, it, vi } from 'vitest';
import { PolygonTool } from './polygon-tool';
import type { Point3Mm } from '../core';

function p(x: number, y: number, z = 0): Point3Mm {
    return { x, y, z };
}

function tool(commit: (ring: readonly Point3Mm[]) => boolean = () => true) {
    const onCommit = vi.fn(commit);
    const t = new PolygonTool({ onCommit, onChange: () => {} });
    t.start();
    return { t, onCommit };
}

describe('PolygonTool', () => {
    it('places vertices on click', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(2400, 0));
        expect(t.vertices).toHaveLength(2);
    });

    it('closes and commits when clicking back on the first vertex', () => {
        const { t, onCommit } = tool();
        t.click(p(0, 0));
        t.click(p(2400, 0));
        t.click(p(2400, 2400));
        t.click(p(100, 100)); // within CLOSE_TOLERANCE_MM of the start
        expect(onCommit).toHaveBeenCalledOnce();
        expect(onCommit.mock.calls[0]![0]).toHaveLength(3);
        expect(t.vertices).toHaveLength(0);
    });

    it('will not close on fewer than three vertices', () => {
        const { t, onCommit } = tool();
        t.click(p(0, 0));
        t.click(p(2400, 0));
        expect(t.wouldClose(p(50, 0))).toBe(false);
        t.click(p(50, 0));
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('keeps the ring armed when a commit is rejected', () => {
        // The store rejects non-modular or degenerate geometry; discarding the user's work at
        // that point would be the worst possible response.
        const { t, onCommit } = tool(() => false);
        t.click(p(0, 0));
        t.click(p(2400, 0));
        t.click(p(2400, 2400));
        t.click(p(0, 0));
        expect(onCommit).toHaveBeenCalledOnce();
        expect(t.vertices).toHaveLength(3);
    });

    it('pops the last vertex on right click', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(2400, 0));
        t.popVertex();
        expect(t.vertices).toHaveLength(1);
    });

    it('ignores a pop on an empty ring', () => {
        const { t } = tool();
        expect(() => t.popVertex()).not.toThrow();
        expect(t.vertices).toHaveLength(0);
    });

    it('ignores a double click on the vertex just placed', () => {
        // Otherwise it becomes a zero-length edge that validation then has to reject.
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(0, 0));
        expect(t.vertices).toHaveLength(1);
    });

    it('drops the ring on cancel', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(2400, 0));
        t.cancel();
        expect(t.isActive).toBe(false);
        expect(t.vertices).toHaveLength(0);
    });

    it('ignores clicks when not armed', () => {
        const onCommit = vi.fn(() => true);
        const t = new PolygonTool({ onCommit, onChange: () => {} });
        t.click(p(0, 0));
        expect(t.vertices).toHaveLength(0);
    });
});
