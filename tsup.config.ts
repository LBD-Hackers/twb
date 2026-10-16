import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'house/index': 'src/house/index.ts',
        'ifc/index': 'src/ifc/index.ts',
        'elements/index': 'src/elements/index.ts',
        'surfacekit/core/index': 'src/surfacekit/core/index.ts',
        'surfacekit/grid/index': 'src/surfacekit/grid/index.ts',
        'surfacekit/model/index': 'src/surfacekit/model/index.ts',
        'surfacekit/interaction/index': 'src/surfacekit/interaction/index.ts',
        'surfacekit/render/index': 'src/surfacekit/render/index.ts',
        'validate/index': 'src/validate/index.ts',
        'validate/node': 'src/validate/node.ts',
        cli: 'src/cli.ts',
    },
    format: ['esm', 'cjs'],
    target: 'es2022',
    platform: 'neutral',
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    // import.meta.url in the CommonJS build (`validate/node.ts` finds the package's ontology by it).
    shims: true,
    external: ['three', /^three\//, 'lit', /^lit\//, 'oxigraph', /^oxigraph\//, /^node:/],
});
