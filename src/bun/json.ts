import { isNumber, isString } from "../shared/guards";
import { isJsonArray, isJsonObject, type Json, type JsonObject } from "../shared/json";

export function parseJson(text: string): Json {
	// SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null, arrays and plain objects
	return JSON.parse(text) as Json;
}

export const objectOr = (value: Json | undefined): JsonObject => (isJsonObject(value) ? value : {});

export const optionalObject = (value: Json | undefined) => (isJsonObject(value) ? value : undefined);

export const arrayOr = (value: Json | undefined): readonly Json[] => (isJsonArray(value) ? value : []);

export const optionalString = (value: Json | undefined) => (isString(value) ? value : undefined);

export const optionalNumber = (value: Json | undefined) => (isNumber(value) ? value : undefined);
