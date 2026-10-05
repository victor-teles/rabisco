/** JSX source tools for components and direct editing (Phase 5): tree, edits, extraction and duplicate detection. */

export { childElements, elementAt, elementCount, findElement, flatten, parseJsx, walk } from "./tree";
export type { JsxAttribute, JsxChild, JsxElement, JsxExpression, JsxString, JsxText, JsxTree } from "./tree";
export { addImport, readImports, removeUnusedImports } from "./imports";
export type { ImportDecl, ImportSpecifier } from "./imports";
export { injectLocations, insertChild, LOC_ATTRIBUTE, parseLocation, removeElement, setAttribute } from "./transforms";
export { shapeKey, slotsOf, subtreeSize } from "./shape";
export type { Slot } from "./shape";
export { extractComponent, extractionSignature } from "./extract";
export type { ExtractedProp, ExtractInput, ExtractResult } from "./extract";
export { extractSuggestion, findDuplicates } from "./duplicates";
export type { DuplicateGroup, DuplicateOccurrence, DuplicateOptions } from "./duplicates";
export { componentSpecifier, exportedNames } from "./modules";
export { suggestName } from "./naming";
export { toPascal } from "./text";
