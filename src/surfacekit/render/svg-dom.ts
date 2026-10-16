/** Tiny SVG element helper — `ui/dom.ts`'s `el`, but in the SVG namespace `createElement` can't reach. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
}
