import { describe, expect, it } from 'vitest';
import { History } from './history';
import { signal } from './signal';

/** A schedule the test drains by hand, so "end of the tick" is explicit. */
function manual(): { schedule: (fn: () => void) => void; tick: () => void } {
    let queue: (() => void)[] = [];
    return {
        schedule: (fn) => queue.push(fn),
        tick: () => {
            const run = queue;
            queue = [];
            for (const fn of run) fn();
        },
    };
}

describe('History', () => {
    it('makes one step of every change in a tick', () => {
        const a = signal(1);
        const b = signal('x');
        const clock = manual();
        const history = new History([a, b], { schedule: clock.schedule });
        a.set(2);
        b.set('y');
        a.set(3);
        clock.tick();
        expect(history.depth()).toBe(1);
        expect(history.undo()).toBe(true);
        expect([a(), b()]).toEqual([1, 'x']);
        expect(history.redo()).toBe(true);
        expect([a(), b()]).toEqual([3, 'y']);
    });

    it('undoes step by step, and a new change drops the redo', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule });
        a.set(1);
        clock.tick();
        a.set(2);
        clock.tick();
        history.undo();
        expect(a()).toBe(1);
        expect(history.canRedo()).toBe(true);
        a.set(5);
        clock.tick();
        expect(history.canRedo()).toBe(false);
        history.undo();
        expect(a()).toBe(1);
        history.undo();
        expect(a()).toBe(0);
        expect(history.undo()).toBe(false);
        expect(history.canUndo()).toBe(false);
    });

    it('does not record its own restores', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule });
        a.set(1);
        clock.tick();
        history.undo();
        clock.tick();
        expect(history.depth()).toBe(0);
        expect(history.canRedo()).toBe(true);
    });

    it('closes an open step before undoing it', () => {
        const a = signal(0);
        const history = new History([a], { schedule: () => {} });
        a.set(1);
        a.set(2);
        history.undo();
        expect(a()).toBe(0);
    });

    it('forgets the oldest step past the limit', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule, limit: 2 });
        for (let i = 1; i <= 4; i++) {
            a.set(i);
            clock.tick();
        }
        expect(history.depth()).toBe(2);
        history.undo();
        history.undo();
        expect(a()).toBe(2);
    });

    it('reset forgets everything', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule });
        a.set(1);
        clock.tick();
        history.reset();
        expect(history.canUndo()).toBe(false);
        expect(history.undo()).toBe(false);
        expect(a()).toBe(1);
    });

    it('squashes the steps since a mark into one', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule });
        a.set(1);
        clock.tick();
        const mark = history.depth();
        for (const n of [2, 3, 4]) {
            a.set(n);
            clock.tick();
        }
        history.squashTo(mark);
        expect(history.depth()).toBe(mark + 1);
        history.undo();
        expect(a()).toBe(1);
    });

    it('discards the steps since a mark, with nothing left to redo', () => {
        const a = signal(0);
        const clock = manual();
        const history = new History([a], { schedule: clock.schedule });
        a.set(1);
        clock.tick();
        const mark = history.depth();
        a.set(2);
        clock.tick();
        a.set(3);
        clock.tick();
        history.discardTo(mark);
        expect(a()).toBe(1);
        expect(history.depth()).toBe(mark);
        expect(history.redo()).toBe(false);
    });
});
