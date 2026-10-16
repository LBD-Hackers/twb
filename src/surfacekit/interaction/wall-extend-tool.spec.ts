import { describe, expect, it } from 'vitest';
import { WallExtendTool } from './wall-extend-tool';

const SOUTH = { aMm: { x: 0, y: 0 }, bMm: { x: 7200, y: 0 } };

function armed(): WallExtendTool {
    const tool = new WallExtendTool({ onChange: () => {} });
    tool.start();
    return tool;
}

describe('WallExtendTool', () => {
    it('pulls from the node to the end on the cursor’s side', () => {
        const tool = armed();
        tool.placeNode(SOUTH, { x: 3600, y: 40 });
        expect(tool.nodes).toEqual([{ x: 3600, y: 0 }]);

        const east = tool.pullAt(
            { x: 6000, y: -2500 },
            tool.distanceAt({ x: 6000, y: -2500 }, 600)
        );
        expect(east).toMatchObject({ fromMm: { x: 3600, y: 0 }, toMm: { x: 7200, y: 0 } });
        expect(east?.offsetMm.x).toBeCloseTo(0);
        expect(east?.offsetMm.y).toBe(-2400);

        const west = tool.pullAt({ x: 1000, y: -2500 }, -2400);
        expect(west).toMatchObject({ fromMm: { x: 0, y: 0 }, toMm: { x: 3600, y: 0 } });
    });

    it('pulls only the part between two nodes', () => {
        const tool = armed();
        tool.placeNode(SOUTH, { x: 2400, y: 0 });
        tool.placeNode(SOUTH, { x: 4800, y: 0 });
        const pull = tool.pullAt({ x: 100, y: 1300 }, 1200);
        expect(pull).toMatchObject({ fromMm: { x: 2400, y: 0 }, toMm: { x: 4800, y: 0 } });
    });

    it('rounds the distance to the grid and has nothing to pull at zero', () => {
        const tool = armed();
        tool.placeNode(SOUTH, { x: 3600, y: 0 });
        expect(tool.distanceAt({ x: 5000, y: 250 }, 600)).toBe(0);
        expect(tool.distanceAt({ x: 5000, y: 1000 }, 600)).toBe(1200);
        expect(tool.pullAt({ x: 5000, y: 250 }, 0)).toBeNull();
    });

    it('steps back a node at a time', () => {
        const tool = armed();
        tool.placeNode(SOUTH, { x: 2400, y: 0 });
        tool.placeNode(SOUTH, { x: 4800, y: 0 });
        tool.popVertex();
        expect(tool.nodes).toHaveLength(1);
        tool.popVertex();
        expect(tool.target).toBeNull();
    });
});
