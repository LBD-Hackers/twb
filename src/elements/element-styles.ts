/**
 * The styles every element's shadow root adopts: its design tokens and the frame around the
 * canvas. The tokens sit on `:host`, so the page embedding the element can override any of them
 * (`arch-paper-model { --accent: … }`).
 */

import { css } from 'lit';

export const tokenStyles = css`
    :host {
        --bg: #f7f7f5;
        --panel: #ffffff;
        --border: #dcdcd6;
        --text: #1f2328;
        --muted: #6b7280;
        --accent: #3f4e4f;
        --danger: #c0392b;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: var(--text);
    }
`;

export const frameStyles = css`
    :host {
        display: block;
        position: relative;
        height: 480px;
        min-height: 200px;
        overflow: hidden;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        contain: content;
    }
    :host([hidden]) {
        display: none;
    }
    .stage {
        position: absolute;
        inset: 0;
    }
    .canvas {
        position: absolute;
        inset: 0;
    }
    .message {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--muted);
        text-align: center;
        pointer-events: none;
    }
    .message.is-error {
        color: var(--danger);
    }
    .element-toolbar {
        position: absolute;
        top: 12px;
        left: 12px;
        z-index: 2;
        display: flex;
        gap: 2px;
        padding: 4px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
        backdrop-filter: blur(6px);
    }
    .element-toolbar button {
        padding: 4px 10px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--text);
        font: inherit;
        cursor: pointer;
    }
    .element-toolbar button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .element-toolbar button.is-active {
        background: var(--accent);
        color: #fff;
    }
    .element-toolbar button:disabled {
        color: var(--muted);
        cursor: default;
    }
    .element-toolbar .sep {
        width: 1px;
        margin: 2px 4px;
        background: var(--border);
    }
    .element-status {
        position: absolute;
        left: 12px;
        bottom: 12px;
        z-index: 2;
        max-width: calc(100% - 24px);
        padding: 4px 8px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
        color: var(--muted);
        pointer-events: none;
    }
    .element-status:empty {
        display: none;
    }
`;
