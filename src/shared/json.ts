/** Unchecked, as decoded */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

/** Fields may be missing, so reads come back `undefined`. */
export type JsonObject = { readonly [key: string]: Json | undefined };

export function isJsonObject(value: Json | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: Json | undefined): value is readonly Json[] {
	return Array.isArray(value);
}
