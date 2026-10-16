/**
 * Every colour and line weight the 3D scene uses, in one table.
 *
 * Mirrors `mep/src/render/theme.ts`: the canvas reads from here, the DOM chrome reads the
 * `:root` custom properties in `styles.css`, and the two are kept consistent by hand. Keeping
 * scene colours out of the modules that build geometry is what makes a retheme a one-file
 * change rather than a search across the renderer.
 */

export const THEME = {
    background: 0xeef1f4,

    grid: {
        /** The 1200 module lines — the system's primary rhythm, so the strongest. */
        module: 0x9aa4ae,
        /** 600 and 400 subdivisions, deliberately faint: guidance, not structure. */
        sub: 0xcdd4da,
        /** The axes through the origin take their colour from `lock` below, by world axis. */
        moduleOpacity: 0.85,
        subOpacity: 0.4,
    },

    surface: {
        /**
         * Every face, until the kind filter is switched on. SketchUp's default face: a face is
         * a face, and it is deliberately not telling you what it is until you ask.
         */
        neutral: 0xf4f2ea,
        /**
         * The kind filter. Three hues far enough apart to read at a glance across a whole
         * house, and none of them the accent blue that means "selected" or "drawing".
         */
        floor: 0x8fbf9a,
        wall: 0xe8b86d,
        roof: 0xd48a7a,
        /** Surfaces are translucent so framing generated inside them stays visible. */
        opacity: 0.55,
        opacitySelected: 0.8,
        /** The model behind a draft drawn over it — roof mode. */
        opacityDimmed: 0.15,
        edge: 0x3a4149,
        edgeDimmed: 0xb4bcc4,
        edgeSelected: 0x3f4e4f,
        hole: 0x5a6b78,
        /** The face under the cursor, when the active tool would act on it. */
        hover: 0x3f4e4f,
    },

    /** Fill colours for generated timber, keyed by the role registry's `colorKey`. */
    timber: {
        stud: 0xd9a566,
        plate: 0xc18a4a,
        joist: 0xc99a5e,
        rafter: 0xbf8f55,
        beam: 0xa87339,
        column: 0x8f5f2c,
        batten: 0xe0c08a,
        /** The end grain of an oak peg (trænagle) through a lap. */
        peg: 0x7a5530,
        /** Thin edges on every member box — without them an instanced box reads as a flat tile. */
        edge: 0x4a3418,
        /** The member the frame tree or a 3D click has picked. */
        edgeSelected: 0x3f4e4f,
    },

    draft: {
        /** The rubber-band line from the last placed vertex to the cursor. */
        line: 0x3f4e4f,
        vertex: 0x3f4e4f,
        /** The closing hint shown when the cursor is over the ring's first vertex. */
        closing: 0x1a9c50,
    },

    /**
     * Snap markers, following the AutoCAD convention users already know:
     * square = vertex, triangle = midpoint, X = intersection, none for grid.
     */
    snap: {
        vertex: 0x1a9c50,
        midpoint: 0x1a9c50,
        intersection: 0x1a9c50,
        edge: 0x7a8894,
        axis: 0xc25b5b,
        grid: 0x7a8894,
        /** No snap at all — the grid is switched off. Deliberately unemphatic. */
        free: 0x7a8894,
        /**
         * The from-point inference: the hovered point it hangs from and the dashed line to the
         * cursor. Teal — not a lock colour, since it is an alignment, not an axis, and not the
         * snap green, since it is a line the cursor rides rather than a point it has reached.
         */
        fromPoint: 0x1f8a8a,
    },

    /**
     * Guides: loose lines that are not the side of any face. Dashed and violet, so they read
     * as construction marks and never as edges of the model — a solid line in the edge colour
     * would look like a wall that failed to become one.
     */
    guide: {
        line: 0x8a5bb5,
        opacity: 0.9,
    },

    /**
     * The engaged axis lock, by world axis. Red X, green Y, blue Z, and magenta for a lock
     * along a sloped face's own axis — SketchUp's inference colours, which a user of that tool already reads without thinking.
     *
     * Colouring the guide is not decoration: the lock changes where a click lands, so the user
     * has to be able to see *which* lock caught before committing to it.
     */
    lock: {
        x: 0xc25b5b,
        y: 0x4f9c60,
        z: 0x3b6fd4,
        diagonal: 0xa64fb0,
    },

    warning: 0xc0392b,
} as const;
