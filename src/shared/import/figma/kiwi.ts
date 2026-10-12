export type KiwiValue = boolean | number | string | Uint8Array | readonly KiwiValue[] | KiwiRecord;

export type KiwiRecord = { readonly [field: string]: KiwiValue | undefined };

type Kind = "enum" | "struct" | "message";

type KiwiField = { name: string; type: string; isArray: boolean; value: number };

type KiwiDefinition = { name: string; kind: Kind; fields: KiwiField[] };

export type KiwiSchema = { definitions: Map<string, KiwiDefinition> };

const KINDS: readonly Kind[] = ["enum", "struct", "message"];

const BUILTINS = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"];

const MAX_DEPTH = 64;

export class KiwiError extends Error {}

class Reader {
	private index = 0;

	private readonly scratch = new DataView(new ArrayBuffer(4));

	private readonly decoder = new TextDecoder();

	constructor(private readonly data: Uint8Array) {}

	get remaining() {
		return this.data.length - this.index;
	}

	byte() {
		if (this.index >= this.data.length) throw new KiwiError("Kiwi data ended early");

		return this.data[this.index++] ?? 0;
	}

	bytes(length: number) {
		if (length > this.remaining) throw new KiwiError("Kiwi data ended early");
		const slice = this.data.slice(this.index, this.index + length);

		this.index += length;

		return slice;
	}

	varUint() {
		let value = 0;
		let shift = 0;
		let byte = 0;

		do {
			byte = this.byte();
			value |= (byte & 127) << shift;
			shift += 7;
		} while (byte & 128 && shift < 35);

		return value >>> 0;
	}

	varInt() {
		const value = this.varUint() | 0;

		return value & 1 ? ~(value >>> 1) : value >>> 1;
	}

	varUint64() {
		let value = 0n;
		let shift = 0n;
		let byte = this.byte();

		while (byte & 128 && shift < 56n) {
			value |= BigInt(byte & 127) << shift;
			shift += 7n;
			byte = this.byte();
		}

		return value | (BigInt(byte) << shift);
	}

	varInt64() {
		const value = this.varUint64();

		return value & 1n ? ~(value >> 1n) : value >> 1n;
	}

	varFloat() {
		const first = this.byte();

		if (first === 0) return 0;
		const rest = this.bytes(3);
		const bits = first | ((rest[0] ?? 0) << 8) | ((rest[1] ?? 0) << 16) | ((rest[2] ?? 0) << 24);

		this.scratch.setInt32(0, (bits << 23) | (bits >>> 9), true);

		return this.scratch.getFloat32(0, true);
	}

	string() {
		const end = this.data.indexOf(0, this.index);

		if (end < 0) throw new KiwiError("Kiwi string has no end");
		const text = this.decoder.decode(this.data.subarray(this.index, end));

		this.index = end + 1;

		return text;
	}
}

export function decodeSchema(data: Uint8Array): KiwiSchema {
	const reader = new Reader(data);
	const count = reader.varUint();

	const raw: { name: string; kind: Kind; fields: { name: string; type: number; isArray: boolean; value: number }[] }[] =
		[];

	for (let i = 0; i < count; i++) {
		const name = reader.string();
		const kind = KINDS[reader.byte()];

		if (!kind) throw new KiwiError(`Unknown Kiwi kind in ${name}`);
		const fieldCount = reader.varUint();
		const fields = [];

		for (let j = 0; j < fieldCount; j++) {
			fields.push({
				name: reader.string(),
				type: reader.varInt(),
				isArray: (reader.byte() & 1) === 1,
				value: reader.varUint(),
			});
		}

		raw.push({ name, kind, fields });
	}

	const typeName = (type: number) => {
		const name = type < 0 ? BUILTINS[~type] : raw[type]?.name;

		if (!name) throw new KiwiError(`Unknown Kiwi type ${type}`);

		return name;
	};

	const definitions = new Map<string, KiwiDefinition>();

	for (const definition of raw) {
		definitions.set(definition.name, {
			name: definition.name,
			kind: definition.kind,
			fields: definition.fields.map((field) => ({
				name: field.name,
				type: definition.kind === "enum" ? "" : typeName(field.type),
				isArray: field.isArray,
				value: field.value,
			})),
		});
	}

	return { definitions };
}

function decodeScalar(reader: Reader, type: string): KiwiValue | null {
	switch (type) {
		case "bool":
			return reader.byte() !== 0;
		case "byte":
			return reader.byte();
		case "int":
			return reader.varInt();
		case "uint":
			return reader.varUint();
		case "float":
			return reader.varFloat();
		case "string":
			return reader.string();
		case "int64":
			return Number(reader.varInt64());
		case "uint64":
			return Number(reader.varUint64());
		default:
			return null;
	}
}

function decodeType(schema: KiwiSchema, reader: Reader, type: string, depth: number): KiwiValue {
	const scalar = decodeScalar(reader, type);

	if (scalar !== null) return scalar;

	const definition = schema.definitions.get(type);

	if (!definition) throw new KiwiError(`Unknown Kiwi type ${type}`);

	if (depth > MAX_DEPTH) throw new KiwiError("Kiwi data is nested too deeply");

	if (definition.kind === "enum") {
		const value = reader.varUint();

		return definition.fields.find((field) => field.value === value)?.name ?? "";
	}

	const record: Record<string, KiwiValue> = {};

	if (definition.kind === "struct") {
		for (const field of definition.fields) record[field.name] = decodeField(schema, reader, field, depth);

		return record;
	}

	for (;;) {
		const id = reader.varUint();

		if (id === 0) return record;
		const field = definition.fields.find((candidate) => candidate.value === id);

		if (!field) throw new KiwiError(`Unknown field ${id} in ${definition.name}`);
		record[field.name] = decodeField(schema, reader, field, depth);
	}
}

function decodeField(schema: KiwiSchema, reader: Reader, field: KiwiField, depth: number): KiwiValue {
	if (!field.isArray) return decodeType(schema, reader, field.type, depth + 1);
	const length = reader.varUint();

	if (field.type === "byte") return reader.bytes(length);

	if (length > reader.remaining) throw new KiwiError("Kiwi array is longer than its data");
	const values: KiwiValue[] = [];

	for (let i = 0; i < length; i++) values.push(decodeType(schema, reader, field.type, depth + 1));

	return values;
}

export function decodeMessage(schema: KiwiSchema, data: Uint8Array, root: string): KiwiRecord {
	const definition = schema.definitions.get(root);

	if (definition?.kind !== "message") throw new KiwiError(`The Kiwi schema has no ${root} message`);
	const value = decodeType(schema, new Reader(data), root, 0);

	return isKiwiRecord(value) ? value : {};
}

export function isKiwiRecord(value: KiwiValue | undefined): value is KiwiRecord {
	return typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

export function isKiwiList(value: KiwiValue | undefined): value is readonly KiwiValue[] {
	return Array.isArray(value);
}
