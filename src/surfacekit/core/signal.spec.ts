import { describe, expect, it, vi } from 'vitest';
import { computed, effect, signal } from './signal';

describe('signal', () => {
    it('holds and updates a value', () => {
        const s = signal(1);
        expect(s()).toBe(1);
        s.set(2);
        expect(s()).toBe(2);
        s.update((v) => v + 10);
        expect(s()).toBe(12);
    });

    it('does not notify when the value is unchanged', () => {
        const s = signal(1);
        const spy = vi.fn();
        effect(() => {
            s();
            spy();
        });
        expect(spy).toHaveBeenCalledTimes(1);
        s.set(1);
        expect(spy).toHaveBeenCalledTimes(1);
        s.set(2);
        expect(spy).toHaveBeenCalledTimes(2);
    });
});

describe('effect', () => {
    it('runs immediately and on every dependency change', () => {
        const s = signal('a');
        const seen: string[] = [];
        effect(() => seen.push(s()));
        s.set('b');
        expect(seen).toEqual(['a', 'b']);
    });

    it('tracks multiple dependencies', () => {
        const a = signal(1);
        const b = signal(10);
        const seen: number[] = [];
        effect(() => seen.push(a() + b()));
        a.set(2);
        b.set(20);
        expect(seen).toEqual([11, 12, 22]);
    });

    it('stops after dispose', () => {
        const s = signal(1);
        const seen: number[] = [];
        const dispose = effect(() => seen.push(s()));
        s.set(2);
        dispose();
        s.set(3);
        expect(seen).toEqual([1, 2]);
    });

    /**
     * The sidebar re-reads different signals depending on whether a model is loaded, so
     * dependencies must be re-collected each run rather than accumulated.
     */
    it('re-collects dependencies on each run', () => {
        const toggle = signal(true);
        const a = signal(1);
        const b = signal(100);
        const seen: number[] = [];
        effect(() => seen.push(toggle() ? a() : b()));

        toggle.set(false);
        expect(seen).toEqual([1, 100]);

        // `a` is no longer a dependency, so changing it must not re-run the effect.
        a.set(2);
        expect(seen).toEqual([1, 100]);

        b.set(200);
        expect(seen).toEqual([1, 100, 200]);
    });
});

describe('computed', () => {
    it('derives from other signals', () => {
        const a = signal(2);
        const b = signal(3);
        const sum = computed(() => a() + b());
        expect(sum()).toBe(5);
        a.set(10);
        expect(sum()).toBe(13);
    });

    it('can be depended on by an effect', () => {
        const a = signal(1);
        const doubled = computed(() => a() * 2);
        const seen: number[] = [];
        effect(() => seen.push(doubled()));
        a.set(5);
        expect(seen).toEqual([2, 10]);
    });
});
