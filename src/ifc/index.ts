/** IFC (IFC2X3, IFC4) to a TWB house file, with a report of what was read and what was left out. */

export {
    ifcToHouse,
    ifcImportSummary,
    isIfcFileName,
    IFC_FILE_ACCEPT,
    type IfcImport,
    type IfcImportOptions,
    type IfcImportReport,
    type SkippedGroup,
} from './ifc-to-house';
export { matchMaterial, isTimber, isMetal, type LayerRole, type MaterialMatch } from './ifc-materials';
export { readStep, type StepEntity, type StepFile, type StepValue } from './step';
export { IfcModel } from './ifc-model';
