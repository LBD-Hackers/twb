import { describe, expect, it, vi } from 'vitest';
import { InteriorWallTool } from './interior-wall-tool';
import type { Point3Mm } from '../core';

function p(x: number, y: number, z = 0): Point3Mm {
    return { x, y, z };
}

function tool(commit: (pointsMm: readonly Point3Mm[]) => boolean = () => true) {
    const onCommit = vi.fn(commit);
    const t = new InteriorWallTool({ onCommit, onChange: () => {} });
    t.start();
    return { t, onCommit };
}

describe('InteriorWallTool', () => {
    it('places vertices on click and does nothing until finish', () => {
        const { t, onCommit } = tool();
        t.click(p(0, 0));
        t.click(p(3600, 0));
        expect(t.vertices).toHaveLength(2);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('finish commits the whole run and clears it', () => {
        const { t, onCommit } = tool();
        t.click(p(0, 0));
        t.click(p(3600, 0));
        t.click(p(3600, 4800));
        t.finish();
        expect(onCommit).toHaveBeenCalledOnce();
        expect(onCommit.mock.calls[0]![0]).toHaveLength(3);
        expect(t.vertices).toHaveLength(0);
    });

    it('will not finish on a single point — there is no segment to build', () => {
        const { t, onCommit } = tool();
        t.click(p(0, 0));
        t.finish();
        expect(onCommit).not.toHaveBeenCalled();
        expect(t.vertices).toHaveLength(1);
    });

    it('keeps the run armed when a commit is rejected', () => {
        const { t, onCommit } = tool(() => false);
        t.click(p(0, 0));
        t.click(p(3600, 0));
        t.finish();
        expect(onCommit).toHaveBeenCalledOnce();
        expect(t.vertices).toHaveLength(2);
    });

    it('pops the last vertex on right click', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(3600, 0));
        t.popVertex();
        expect(t.vertices).toHaveLength(1);
    });

    it('ignores a double click on the vertex just placed', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.click(p(0, 0));
        expect(t.vertices).toHaveLength(1);
    });

    it('drops the run on cancel', () => {
        const { t } = tool();
        t.click(p(0, 0));
        t.cancel();
        expect(t.isActive).toBe(false);
        expect(t.vertices).toHaveLength(0);
    });
});
