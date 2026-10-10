export { childElements, elementAt, elementCount, findElement, flatten, parseJsx, walk } from "./tree";

export type { JsxAttribute, JsxChild, JsxElement, JsxExpression, JsxString, JsxText, JsxTree } from "./tree";

export { addImport, readImports, removeUnusedImports } from "./imports";

export type { ImportDecl, ImportSpecifier } from "./imports";

export {
	childSlots,
	duplicateElement,
	injectLocations,
	insertAt,
	insertChild,
	isElementCode,
	LOC_ATTRIBUTE,
	moveAmongSiblings,
	moveElement,
	parseLocation,
	pasteElement,
	removeElement,
	setAttribute,
	STACK_CLASSES,
	unwrapElement,
	wrapElement,
	wrapInStack,
} from "./transforms";

export { structureKey, slotsOf, subtreeSize } from "./structure";

export type { Slot } from "./structure";

export { extractComponent, extractionSignature } from "./extract";

export type { ExtractedProp, ExtractInput, ExtractResult } from "./extract";

export { extractSuggestion, findDuplicates } from "./duplicates";

export type { DuplicateGroup, DuplicateOccurrence, DuplicateOptions } from "./duplicates";

export { mappedEntries, moveMappedEntry } from "./lists";

export { componentSpecifier, exportedNames } from "./modules";

export { suggestName } from "./naming";

export { toPascal } from "./text";
