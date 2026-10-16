/**
 * The embeddable elements, as web components (Lit):
 *
 * - `<arch-paper-model>`: the paper model of a house file — its thin faces on the structure's
 *   reference planes — read-only or editable (`arch-paper-model.ts`).
 *
 * Importing this module defines it. It needs `lit` and `three` beside it.
 */

import { ArchPaperModel } from './arch-paper-model';

export { ArchPaperModel };
export { HouseViewElement } from './house-view-element';
export type { FaceSelectDetail, HouseChangeDetail } from './arch-paper-model';
export type { HouseLoadDetail } from './house-view-element';

// Defined once, so a page that loads the bundle twice does not throw.
if (typeof customElements !== 'undefined' && !customElements.get('arch-paper-model')) {
    customElements.define('arch-paper-model', ArchPaperModel);
}

declare global {
    interface HTMLElementTagNameMap {
        'arch-paper-model': ArchPaperModel;
    }
}
