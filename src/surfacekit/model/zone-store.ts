/**
 * The zones and the zone separations, as reactive lists — the room layer over the surfaces,
 * kept beside `SurfaceStore` rather than inside it.
 *
 * Separate because nothing about a face depends on the rooms drawn over it: the frame, the IFC
 * and the classification are the same whether or not a single room has been named. A profile
 * with no use for rooms never has to construct one of these.
 *
 * Every mutation replaces the array, the same discipline `SurfaceStore` follows, so `Object.is`
 * change detection in `signal.ts` sees it.
 */

import { signal, type Vec2Mm } from '../core';
import type { StoreyId } from './storey';
import {
    DEFAULT_LOWERED_CEILING_MM,
    type Zone,
    type ZoneCeilingKind,
    type ZoneId,
    type ZoneSeparation,
    type ZoneSeparationId,
} from './zone';

/** Shortest separation worth keeping, mm. Below this it is a double click, not a line. */
const MIN_SEPARATION_MM = 50;

let nextZoneId = 1;
let nextSeparationId = 1;

const mintZoneId = (): ZoneId => `z${nextZoneId++}`;
const mintSeparationId = (): ZoneSeparationId => `zs${nextSeparationId++}`;

/** Rebases both id counters above every loaded id, so nothing drawn after a load collides. */
function noteExistingIds(zones: readonly Zone[], separations: readonly ZoneSeparation[]): void {
    for (const z of zones) {
        const n = Number(z.id.slice(1));
        if (Number.isFinite(n) && n >= nextZoneId) nextZoneId = n + 1;
    }
    for (const s of separations) {
        const n = Number(s.id.slice(2));
        if (Number.isFinite(n) && n >= nextSeparationId) nextSeparationId = n + 1;
    }
}

const round = (p: Vec2Mm): Vec2Mm => ({ x: Math.round(p.x), y: Math.round(p.y) });

export class ZoneStore {
    readonly zones = signal<readonly Zone[]>([]);
    readonly separations = signal<readonly ZoneSeparation[]>([]);
    readonly selectedId = signal<ZoneId | null>(null);
    readonly selectedSeparationId = signal<ZoneSeparationId | null>(null);

    /** Adds a zone and selects it. */
    add(zone: Omit<Zone, 'id'>): Zone {
        const created: Zone = { ...zone, id: mintZoneId(), seedMm: round(zone.seedMm) };
        this.zones.update((list) => [...list, created]);
        this.select(created.id);
        return created;
    }

    rename(id: ZoneId, name: string): boolean {
        return this.patch(id, { name });
    }

    setKind(id: ZoneId, kindId: string): boolean {
        return this.patch(id, { kindId });
    }

    /**
     * How the room is ceiled; a lowered ceiling with its height, mm above its storey's floor.
     * Flat is the default, so it is stored as nothing.
     */
    setCeiling(id: ZoneId, kind: ZoneCeilingKind, loweredMm?: number): boolean {
        const zone = this.get(id);
        if (!zone) return false;
        const { ceiling: _kind, ceilingMm: _old, ...rest } = zone;
        const next: Zone =
            kind === 'flat'
                ? rest
                : kind === 'open'
                  ? { ...rest, ceiling: kind }
                  : {
                        ...rest,
                        ceiling: kind,
                        ceilingMm: Math.round(loweredMm ?? DEFAULT_LOWERED_CEILING_MM),
                    };
        this.zones.update((list) => list.map((z) => (z.id === id ? next : z)));
        return true;
    }

    remove(id: ZoneId): void {
        this.zones.update((list) => list.filter((z) => z.id !== id));
        if (this.selectedId() === id) this.selectedId.set(null);
    }

    /** A polyline of separations on one storey, one per segment. Returns what was added. */
    addSeparations(storeyId: StoreyId, pointsMm: readonly Vec2Mm[]): ZoneSeparation[] {
        const added: ZoneSeparation[] = [];
        for (let i = 0; i + 1 < pointsMm.length; i++) {
            const aMm = round(pointsMm[i]!);
            const bMm = round(pointsMm[i + 1]!);
            if (Math.hypot(bMm.x - aMm.x, bMm.y - aMm.y) < MIN_SEPARATION_MM) continue;
            added.push({ id: mintSeparationId(), storeyId, aMm, bMm });
        }
        if (added.length > 0) this.separations.update((list) => [...list, ...added]);
        return added;
    }

    removeSeparation(id: ZoneSeparationId): void {
        this.separations.update((list) => list.filter((s) => s.id !== id));
        if (this.selectedSeparationId() === id) this.selectedSeparationId.set(null);
    }

    /**
     * Drops every zone and separation on a storey that no longer exists — neither means
     * anything without the storey it stands on. Returns how many zones went.
     */
    pruneStoreys(storeyIds: ReadonlySet<StoreyId>): number {
        const before = this.zones().length;
        this.zones.update((list) => list.filter((z) => storeyIds.has(z.storeyId)));
        this.separations.update((list) => list.filter((s) => storeyIds.has(s.storeyId)));
        if (this.selectedId() && !this.get(this.selectedId()!)) this.selectedId.set(null);
        const sep = this.selectedSeparationId();
        if (sep && !this.separations().some((s) => s.id === sep)) {
            this.selectedSeparationId.set(null);
        }
        return before - this.zones().length;
    }

    /** Selects a zone. A zone and a separation are never selected at once. */
    select(id: ZoneId | null): void {
        this.selectedId.set(id);
        if (id !== null) this.selectedSeparationId.set(null);
    }

    selectSeparation(id: ZoneSeparationId | null): void {
        this.selectedSeparationId.set(id);
        if (id !== null) this.selectedId.set(null);
    }

    get(id: ZoneId): Zone | undefined {
        return this.zones().find((z) => z.id === id);
    }

    forStorey(storeyId: StoreyId): Zone[] {
        return this.zones().filter((z) => z.storeyId === storeyId);
    }

    separationsForStorey(storeyId: StoreyId): ZoneSeparation[] {
        return this.separations().filter((s) => s.storeyId === storeyId);
    }

    /** Replaces everything with a loaded file's, keeping ids. */
    load(zones: readonly Zone[], separations: readonly ZoneSeparation[] = []): void {
        noteExistingIds(zones, separations);
        this.zones.set(zones.map((z) => ({ ...z, seedMm: round(z.seedMm) })));
        this.separations.set([...separations]);
        this.selectedId.set(null);
        this.selectedSeparationId.set(null);
    }

    clear(): void {
        this.load([], []);
    }

    private patch(id: ZoneId, patch: Partial<Omit<Zone, 'id'>>): boolean {
        if (!this.get(id)) return false;
        this.zones.update((list) => list.map((z) => (z.id === id ? { ...z, ...patch } : z)));
        return true;
    }
}
