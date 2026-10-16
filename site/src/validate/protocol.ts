/** What the validator page and its worker say to each other. */

import type { DetectedInput, Report } from '@twb/validate';

export interface InputFile {
    name: string;
    text: string;
}

export interface ValidateRequest extends InputFile {
    id: number;
    /** For a graph: apply the rules before the shapes. */
    rules: boolean;
    /** More graphs loaded with a graph: its adjacency rules, say. */
    extra: InputFile[];
}

export interface ValidateResponse {
    id: number;
    /** Null when the file is none of the three kinds, or the validation threw. */
    report: Report | null;
    input: DetectedInput;
    /** The house file to show: the file itself, or the house an IFC model became. */
    house: string | null;
    /** Extra files that were not graphs, and so were left out. */
    ignored: string[];
}
