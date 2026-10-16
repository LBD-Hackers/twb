import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const ONTOLOGY = fileURLToPath(new URL('../ontology/', import.meta.url));

/** Every file under `dir`, as paths relative to it. */
function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory()
            ? files(path).map((f) => `${name}/${f}`)
            : [relative(dir, path)];
    });
}

/**
 * What https://w3id.org/twb sends an RDF client to, published beside the pages: every file of
 * `ontology/` at `ontology/`, and the house file's JSON-LD contexts at `context/{n}.jsonld`.
 * GitHub Pages serves them as `text/turtle` and `application/ld+json`; the dev server does too.
 */
function published(): { path: string; source: string; type: string }[] {
    const type = (f: string) =>
        f.endsWith('.ttl')
            ? 'text/turtle; charset=utf-8'
            : f.endsWith('.jsonld') || f.endsWith('.json')
              ? 'application/ld+json'
              : 'text/plain; charset=utf-8';
    return [
        ...files(ONTOLOGY).map((f) => ({ path: `ontology/${f}`, source: join(ONTOLOGY, f), type: type(f) })),
        { path: 'context/2.jsonld', source: join(ONTOLOGY, 'twb-house.context.jsonld'), type: 'application/ld+json' },
        { path: 'context/1.jsonld', source: join(ONTOLOGY, 'twb-house.context.1.jsonld'), type: 'application/ld+json' },
    ];
}

function twbFiles(): Plugin {
    return {
        name: 'twb-files',
        configureServer(server) {
            for (const f of published()) {
                server.middlewares.use(`/twb/${f.path}`, (_req, res) => {
                    res.setHeader('Content-Type', f.type);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(readFileSync(f.source));
                });
            }
        },
        generateBundle() {
            for (const f of published()) {
                this.emitFile({ type: 'asset', fileName: f.path, source: readFileSync(f.source) });
            }
        },
    };
}

/**
 * The TWB data model's pages, served by GitHub Pages at https://lbd-hackers.github.io/twb/: the
 * overview (`index.html`), every term (`reference/`) and the validator (`validate/`). The library
 * is read from its source (`@twb` → `../src`), so the pages always show this commit's code.
 */
export default defineConfig({
    base: '/twb/',
    plugins: [react(), twbFiles()],
    server: { port: 5198, strictPort: true },
    worker: { format: 'es' },
    resolve: {
        alias: { '@twb': fileURLToPath(new URL('../src', import.meta.url)) },
        dedupe: ['lit', 'three'],
    },
    build: {
        target: 'es2022',
        rollupOptions: {
            input: {
                index: fileURLToPath(new URL('index.html', import.meta.url)),
                reference: fileURLToPath(new URL('reference/index.html', import.meta.url)),
                validate: fileURLToPath(new URL('validate/index.html', import.meta.url)),
            },
        },
    },
    test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
