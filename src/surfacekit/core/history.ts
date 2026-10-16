/**
 * Undo and redo over a set of signals, by snapshot.
 *
 * The model is already a handful of signals holding immutable values — every mutation replaces
 * the array — so a snapshot is just the current value of each, and restoring one is setting them
 * back. Nothing is copied and no store has to know it is being recorded.
 *
 * What makes one undo step is not one `set` but one *action*: a single click of the Line tool can
 * break an edge, add a guide and add a face, three writes the user sees as one. So the first
 * change in a synchronous run opens a step, and a microtask closes it — everything the click did
 * before control returned to the browser is one step, without any caller having to say where an
 * action begins or ends.
 */

import { effect, signal, type Signal } from './signal';

type Snapshot = readonly unknown[];

export interface HistoryOptions {
    /** Steps kept before the oldest is forgotten. */
    limit?: number;
    /** Closes an open step later. `queueMicrotask` by default; tests pass their own. */
    schedule?: (fn: () => void) => void;
}

export class History {
    /** Whether there is a step to undo / redo, for buttons and menus. */
    readonly canUndo = signal(false);
    readonly canRedo = signal(false);

    private readonly undoStack: Snapshot[] = [];
    private readonly redoStack: Snapshot[] = [];
    /** The state as of the last closed step — what an open step will be undone to. */
    private committed: Snapshot;
    private open = false;
    private restoring = false;
    private readonly limit: number;
    private readonly schedule: (fn: () => void) => void;

    constructor(
        private readonly tracked: readonly Signal<unknown>[],
        options: HistoryOptions = {}
    ) {
        this.limit = options.limit ?? 200;
        this.schedule = options.schedule ?? ((fn) => queueMicrotask(fn));
        this.committed = this.snapshot();
        for (const s of tracked) {
            let first = true;
            effect(() => {
                s();
                if (first) {
                    first = false;
                    return;
                }
                this.changed();
            });
        }
    }

    /** How many steps can be undone — lets a tool undo back to a mark it took earlier. */
    depth(): number {
        this.flush();
        return this.undoStack.length;
    }

    undo(): boolean {
        this.flush();
        const previous = this.undoStack.pop();
        if (!previous) return false;
        this.redoStack.push(this.committed);
        this.restore(previous);
        return true;
    }

    redo(): boolean {
        this.flush();
        const next = this.redoStack.pop();
        if (!next) return false;
        this.undoStack.push(this.committed);
        this.restore(next);
        return true;
    }

    /**
     * Folds every step taken since the undo stack was `depth` deep into one — so a session of
     * drawing that ends in a single decision (roof mode's Save) undoes as that decision.
     */
    squashTo(depth: number): void {
        this.flush();
        if (this.undoStack.length > depth + 1) this.undoStack.length = depth + 1;
        this.redoStack.length = 0;
        this.sync();
    }

    /**
     * Goes back to how things were when the undo stack was `depth` deep and forgets the steps
     * in between, redo included — roof mode's Cancel, which is not an undo anyone would redo.
     */
    discardTo(depth: number): void {
        this.flush();
        if (this.undoStack.length <= depth) return;
        const snapshot = this.undoStack[depth]!;
        this.undoStack.length = depth;
        this.redoStack.length = 0;
        this.restore(snapshot);
    }

    /** Forgets every step — a file was opened, and undoing into the last one is not an edit. */
    reset(): void {
        this.flush();
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.committed = this.snapshot();
        this.sync();
    }

    /** Closes an open step now rather than at the end of the tick. */
    flush(): void {
        if (!this.open) return;
        this.open = false;
        this.committed = this.snapshot();
    }

    private changed(): void {
        if (this.restoring) return;
        if (this.open) return;
        this.open = true;
        this.undoStack.push(this.committed);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack.length = 0;
        this.sync();
        this.schedule(() => this.flush());
    }

    private restore(snapshot: Snapshot): void {
        this.restoring = true;
        try {
            this.tracked.forEach((s, i) => s.set(snapshot[i]));
        } finally {
            this.restoring = false;
        }
        // Read back rather than assumed: an effect reacting to the restore may have written a
        // tracked signal too, and the next step must be undone to what is really there.
        this.committed = this.snapshot();
        this.sync();
    }

    private snapshot(): Snapshot {
        return this.tracked.map((s) => s());
    }

    private sync(): void {
        this.canUndo.set(this.undoStack.length > 0);
        this.canRedo.set(this.redoStack.length > 0);
    }
}
