import { isBoolean, isNumber, isString } from "../../guards";
import type { KiwiValue } from "../../import/figma/kiwi";

export type SchemaField = [name: string, type: string, isArray?: boolean];

export type SchemaDefinition = { name: string; kind: "enum" | "struct" | "message"; fields: SchemaField[] | string[] };

type WriteRecord = { readonly [field: string]: WriteValue };

export type WriteValue = KiwiValue | bigint | undefined | readonly WriteValue[] | WriteRecord;

const BUILTINS = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"];

const KINDS = ["enum", "struct", "message"];

export const enumOf = (name: string, values: string[]): SchemaDefinition => ({ name, kind: "enum", fields: values });

class Writer {
	private buffer = new Uint8Array(1024);

	private length = 0;

	private readonly scratch = new DataView(new ArrayBuffer(4));

	private readonly encoder = new TextEncoder();

	private reserve(extra: number) {
		if (this.length + extra <= this.buffer.length) return;
		const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));

		grown.set(this.buffer.subarray(0, this.length));
		this.buffer = grown;
	}

	byte(value: number) {
		this.reserve(1);
		this.buffer[this.length++] = value & 255;
	}

	raw(bytes: Uint8Array) {
		this.reserve(bytes.length);
		this.buffer.set(bytes, this.length);
		this.length += bytes.length;
	}

	varUint(value: number) {
		let rest = value >>> 0;

		do {
			const byte = rest & 127;

			rest >>>= 7;
			this.byte(rest ? byte | 128 : byte);
		} while (rest);
	}

	varInt(value: number) {
		this.varUint((value << 1) ^ (value >> 31));
	}

	varInt64(value: bigint) {
		let rest = value < 0n ? (~value << 1n) | 1n : value << 1n;

		for (let i = 0; i < 8 && rest > 127n; i++) {
			this.byte(Number(rest & 127n) | 128);
			rest >>= 7n;
		}

		this.byte(Number(rest));
	}

	varFloat(value: number) {
		this.scratch.setFloat32(0, value, true);
		const raw = this.scratch.getInt32(0, true);
		const bits = (raw >>> 23) | (raw << 9);

		if ((bits & 255) === 0) {
			this.byte(0);

			return;
		}

		this.byte(bits);
		this.byte(bits >> 8);
		this.byte(bits >> 16);
		this.byte(bits >> 24);
	}

	string(value: string) {
		this.raw(this.encoder.encode(value));
		this.byte(0);
	}

	done() {
		return this.buffer.slice(0, this.length);
	}
}

export function encodeSchema(definitions: SchemaDefinition[]) {
	const writer = new Writer();

	const index = (type: string) => {
		const builtin = BUILTINS.indexOf(type);

		return builtin >= 0 ? ~builtin : definitions.findIndex((definition) => definition.name === type);
	};

	writer.varUint(definitions.length);

	for (const definition of definitions) {
		writer.string(definition.name);
		writer.byte(KINDS.indexOf(definition.kind));
		writer.varUint(definition.fields.length);
		definition.fields.forEach((field, i) => {
			const [name, type, isArray] = isString(field) ? [field, "", false] : field;

			writer.string(name);
			writer.varInt(type ? index(type) : 0);
			writer.byte(isArray ? 1 : 0);
			writer.varUint(definition.kind === "enum" ? i : i + 1);
		});
	}

	return writer.done();
}

const isBigInt = (value: WriteValue): value is bigint => typeof value === "bigint";

const isWriteRecord = (value: WriteValue): value is WriteRecord =>
	typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);

function encodeValue(writer: Writer, definitions: Map<string, SchemaDefinition>, type: string, value: WriteValue) {
	if (isBoolean(value) && type === "bool") return writer.byte(value ? 1 : 0);

	if (isNumber(value)) {
		if (type === "byte") return writer.byte(value);

		if (type === "int") return writer.varInt(value);

		if (type === "uint") return writer.varUint(value);

		if (type === "float") return writer.varFloat(value);
	}

	if (isBigInt(value)) return writer.varInt64(value);
	const definition = definitions.get(type);

	if (isString(value) && type === "string") return writer.string(value);

	if (!definition) throw new Error(`Bad Kiwi value for ${type}`);

	if (definition.kind === "enum") {
		const index = definition.fields.findIndex((field) => field === value);

		if (index < 0) throw new Error(`Bad Kiwi value for ${type}`);

		return writer.varUint(index);
	}

	if (!isWriteRecord(value)) throw new Error(`Bad Kiwi value for ${type}`);

	definition.fields.forEach((field, i) => {
		if (isString(field)) return;
		const [name, fieldType, isArray] = field;
		const fieldValue = value[name];

		if (definition.kind === "message") {
			if (fieldValue === undefined) return;
			writer.varUint(i + 1);
		}

		if (!isArray) return encodeValue(writer, definitions, fieldType, fieldValue);

		if (fieldValue instanceof Uint8Array && fieldType === "byte") {
			writer.varUint(fieldValue.length);

			return writer.raw(fieldValue);
		}

		const list = Array.isArray(fieldValue) ? fieldValue : [];

		writer.varUint(list.length);

		for (const item of list) encodeValue(writer, definitions, fieldType, item);
	});

	if (definition.kind === "message") writer.varUint(0);
}

export function encodeMessage(definitions: SchemaDefinition[], root: string, value: WriteValue) {
	const writer = new Writer();

	encodeValue(writer, new Map(definitions.map((definition) => [definition.name, definition])), root, value);

	return writer.done();
}

export function figKiwi(schema: Uint8Array, data: Uint8Array, version: number) {
	const prelude = new TextEncoder().encode("fig-kiwi");
	const out = new Uint8Array(prelude.length + 4 + 4 + schema.length + 4 + data.length);
	const view = new DataView(out.buffer);
	let offset = prelude.length;

	out.set(prelude);
	view.setUint32(offset, version, true);
	offset += 4;
	view.setUint32(offset, schema.length, true);
	out.set(schema, offset + 4);
	offset += 4 + schema.length;
	view.setUint32(offset, data.length, true);
	out.set(data, offset + 4);

	return out;
}

export function base64(bytes: Uint8Array) {
	let binary = "";

	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

	return btoa(binary);
}
