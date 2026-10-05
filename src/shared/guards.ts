/** Primitive checks as type guards, for values whose type is a union of a few representations. */

export const isString = <T>(value: T): value is T & string => typeof value === "string";

export const isNumber = <T>(value: T): value is T & number => typeof value === "number";

export const isBoolean = <T>(value: T): value is T & boolean => typeof value === "boolean";

export const isFiniteNumber = <T>(value: T): value is T & number => isNumber(value) && Number.isFinite(value);
