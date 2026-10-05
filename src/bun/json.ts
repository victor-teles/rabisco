/**
 * Reading JSON text (files, CLI output, HTTP bodies) in the main process, and
 * small readers that decode it field by field into domain types.
 */

import { isNumber, isString } from "../shared/guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../shared/json";

/** `JSON.parse`, typed as what it can return. Throws on malformed text. */
export function parseJson(text: string): Json {
	// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
	return JSON.parse(text) as Json;
}

/** The object, or an empty one so that its fields read as missing. */
export const objectOr = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : {});

/** The object, or undefined when the value is anything else. */
export const optionalObject = (value: Json | undefined) => (isJsonObject(value) ? value : undefined);

/** The array, or an empty one when the value is anything else. */
export const arrayOr = (value: Json | undefined): readonly Json[] => (isJsonArray(value) ? value : []);

export const optionalString = (value: Json | undefined) => (isString(value) ? value : undefined);

export const optionalNumber = (value: Json | undefined) => (isNumber(value) ? value : undefined);
