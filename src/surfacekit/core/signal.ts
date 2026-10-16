/**
 * Minimal reactive primitive. We have no framework, but the UI still needs to stay in
 * sync with the zone store, the active storey and the calculation results without every
 * widget knowing about every other widget.
 *
 * Deliberately tiny: a value, subscribers, and automatic dependency tracking for
 * `computed` / `effect`. No batching, no async scheduling — the data volumes here (tens
 * of zones, a handful of storeys) do not justify it.
 */

type Subscriber = () => void;

/** The effect currently running, so `get()` can register a dependency on itself. */
let activeSubscriber: { run: Subscriber; deps: Set<Set<Subscriber>> } | null = null;

export interface ReadonlySignal<T> {
    (): T;
}

export interface Signal<T> extends ReadonlySignal<T> {
    set(value: T): void;
    update(fn: (current: T) => T): void;
}

export function signal<T>(initial: T): Signal<T> {
    let value = initial;
    const subscribers = new Set<Subscriber>();

    const read = (() => {
        if (activeSubscriber) {
            subscribers.add(activeSubscriber.run);
            activeSubscriber.deps.add(subscribers);
        }
        return value;
    }) as Signal<T>;

    read.set = (next: T) => {
        if (Object.is(next, value)) return;
        value = next;
        // Copy before iterating: an effect may re-subscribe while we notify.
        for (const run of [...subscribers]) run();
    };

    read.update = (fn: (current: T) => T) => read.set(fn(value));

    return read;
}

/**
 * Runs `fn` immediately and again whenever any signal it read changes.
 * Returns a dispose function.
 */
export function effect(fn: () => void): () => void {
    const deps = new Set<Set<Subscriber>>();
    const holder = {
        run: () => {
            cleanup();
            const previous = activeSubscriber;
            activeSubscriber = holder;
            try {
                fn();
            } finally {
                activeSubscriber = previous;
            }
        },
        deps,
    };

    function cleanup(): void {
        for (const set of deps) set.delete(holder.run);
        deps.clear();
    }

    holder.run();
    return cleanup;
}

/** A signal derived from others. Recomputed lazily-eagerly: on each dependency change. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
    const out = signal<T>(undefined as T);
    effect(() => out.set(fn()));
    return out;
}
