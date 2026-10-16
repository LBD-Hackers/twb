/**
 * What the pages share of their words. The data model page's text (`model/copy.ts`) is kept in
 * both languages, as it came from twb.madsholten.dk; these pages render the English.
 */

export type Lang = 'da' | 'en';

export type Text = Record<Lang, string>;

/** The language the pages render. */
export const LANG: Lang = 'en';

/** `text` with each `{name}` replaced by `values[name]`. */
export function fill(text: string, values: Record<string, string | number>): string {
    return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

/** A number the way the language writes it: 7,47 in Danish, 7.47 in English. */
export function num(value: number, lang: Lang, digits = 0): string {
    return value.toLocaleString(lang === 'da' ? 'da-DK' : 'en-GB', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

/** Where the site is served from: `/twb/` on GitHub Pages. */
export const BASE = import.meta.env.BASE_URL;

export const LINKS = {
    repo: 'https://github.com/LBD-Hackers/twb',
    npm: 'https://www.npmjs.com/package/@lbd-hackers/twb',
    arch: 'https://twb.madsholten.dk',
    namespace: 'https://w3id.org/twb',
};
