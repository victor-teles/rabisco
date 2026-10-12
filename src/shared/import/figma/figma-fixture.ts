import { deflateSync } from "fflate";
import { isBoolean, isNumber, isString } from "../../guards";
import type { KiwiValue } from "./kiwi";

type FixtureField = [name: string, type: string, isArray?: boolean];

type FixtureDefinition = { name: string; kind: "enum" | "struct" | "message"; fields: FixtureField[] | string[] };

const BUILTINS = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"];

const KINDS = ["enum", "struct", "message"];

const enumOf = (name: string, values: string[]): FixtureDefinition => ({ name, kind: "enum", fields: values });

export const FIGMA_SCHEMA: FixtureDefinition[] = [
	enumOf("MessageType", ["JOIN_START", "NODE_CHANGES"]),
	enumOf("NodeType", [
		"NONE",
		"DOCUMENT",
		"CANVAS",
		"GROUP",
		"FRAME",
		"VECTOR",
		"LINE",
		"ELLIPSE",
		"RECTANGLE",
		"TEXT",
		"INSTANCE",
		"SYMBOL",
		"VARIABLE",
	]),
	enumOf("PaintType", ["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL", "IMAGE"]),
	enumOf("StackMode", ["NONE", "HORIZONTAL", "VERTICAL"]),
	enumOf("StackJustify", ["MIN", "CENTER", "MAX", "SPACE_EVENLY", "SPACE_BETWEEN"]),
	enumOf("StackAlign", ["MIN", "CENTER", "MAX", "BASELINE"]),
	enumOf("StackCounterAlign", ["MIN", "CENTER", "MAX", "STRETCH", "AUTO", "BASELINE"]),
	enumOf("StackSize", ["FIXED", "RESIZE_TO_FIT", "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"]),
	enumOf("StackPositioning", ["AUTO", "ABSOLUTE"]),
	enumOf("StackWrap", ["NO_WRAP", "WRAP"]),
	enumOf("NumberUnits", ["RAW", "PIXELS", "PERCENT"]),
	enumOf("TextAlignHorizontal", ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]),
	enumOf("TextAutoResize", ["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]),
	enumOf("TextCase", ["ORIGINAL", "UPPER", "LOWER", "TITLE"]),
	enumOf("EffectType", ["INNER_SHADOW", "DROP_SHADOW", "FOREGROUND_BLUR", "BACKGROUND_BLUR"]),
	enumOf("VariableField", ["MISSING", "CORNER_RADIUS", "STACK_SPACING", "STACK_PADDING_LEFT", "STACK_PADDING_TOP"]),
	{
		name: "GUID",
		kind: "struct",
		fields: [
			["sessionID", "uint"],
			["localID", "uint"],
		],
	},
	{
		name: "Color",
		kind: "struct",
		fields: [
			["r", "float"],
			["g", "float"],
			["b", "float"],
			["a", "float"],
		],
	},
	{
		name: "Vector",
		kind: "struct",
		fields: [
			["x", "float"],
			["y", "float"],
		],
	},
	{
		name: "Matrix",
		kind: "struct",
		fields: [
			["m00", "float"],
			["m01", "float"],
			["m02", "float"],
			["m10", "float"],
			["m11", "float"],
			["m12", "float"],
		],
	},
	{
		name: "ParentIndex",
		kind: "struct",
		fields: [
			["guid", "GUID"],
			["position", "string"],
		],
	},
	{
		name: "VariableID",
		kind: "message",
		fields: [
			["guid", "GUID"],
			["key", "string"],
		],
	},
	{
		name: "VariableDataValues",
		kind: "message",
		fields: [
			["alias", "VariableID"],
			["floatValue", "float"],
		],
	},
	{ name: "VariableData", kind: "message", fields: [["value", "VariableDataValues"]] },
	{
		name: "ColorStop",
		kind: "struct",
		fields: [
			["color", "Color"],
			["position", "float"],
		],
	},
	{
		name: "Image",
		kind: "message",
		fields: [
			["hash", "byte", true],
			["name", "string"],
		],
	},
	{
		name: "Paint",
		kind: "message",
		fields: [
			["type", "PaintType"],
			["color", "Color"],
			["opacity", "float"],
			["visible", "bool"],
			["stops", "ColorStop", true],
			["transform", "Matrix"],
			["image", "Image"],
			["colorVar", "VariableData"],
		],
	},
	{
		name: "Effect",
		kind: "message",
		fields: [
			["type", "EffectType"],
			["color", "Color"],
			["offset", "Vector"],
			["radius", "float"],
			["visible", "bool"],
			["spread", "float"],
		],
	},
	{
		name: "FontName",
		kind: "struct",
		fields: [
			["family", "string"],
			["style", "string"],
			["postscript", "string"],
		],
	},
	{
		name: "Number",
		kind: "struct",
		fields: [
			["value", "float"],
			["units", "NumberUnits"],
		],
	},
	{ name: "TextData", kind: "message", fields: [["characters", "string"]] },
	{
		name: "VariableDataMapEntry",
		kind: "message",
		fields: [
			["variableField", "VariableField"],
			["variableData", "VariableData"],
		],
	},
	{ name: "VariableDataMap", kind: "message", fields: [["entries", "VariableDataMapEntry", true]] },
	{
		name: "NodeChange",
		kind: "message",
		fields: [
			["guid", "GUID"],
			["parentIndex", "ParentIndex"],
			["type", "NodeType"],
			["name", "string"],
			["visible", "bool"],
			["opacity", "float"],
			["size", "Vector"],
			["transform", "Matrix"],
			["cornerRadius", "float"],
			["fontSize", "float"],
			["strokeWeight", "float"],
			["textAlignHorizontal", "TextAlignHorizontal"],
			["textCase", "TextCase"],
			["fillPaints", "Paint", true],
			["strokePaints", "Paint", true],
			["lineHeight", "Number"],
			["fontName", "FontName"],
			["textData", "TextData"],
			["effects", "Effect", true],
			["textAutoResize", "TextAutoResize"],
			["stackMode", "StackMode"],
			["stackSpacing", "float"],
			["frameMaskDisabled", "bool"],
			["letterSpacing", "Number"],
			["stackHorizontalPadding", "float"],
			["stackVerticalPadding", "float"],
			["stackPrimarySizing", "StackSize"],
			["stackPrimaryAlignItems", "StackJustify"],
			["stackCounterAlignItems", "StackAlign"],
			["stackChildPrimaryGrow", "float"],
			["stackPaddingRight", "float"],
			["stackPaddingBottom", "float"],
			["stackChildAlignSelf", "StackCounterAlign"],
			["stackPositioning", "StackPositioning"],
			["stackCounterSizing", "StackSize"],
			["stackWrap", "StackWrap"],
			["variableConsumptionMap", "VariableDataMap"],
			["rectangleTopLeftCornerRadius", "float"],
			["rectangleCornerRadiiIndependent", "bool"],
			["int64Field", "int64"],
			["signed", "int"],
		],
	},
	{
		name: "Message",
		kind: "message",
		fields: [
			["type", "MessageType"],
			["nodeChanges", "NodeChange", true],
		],
	},
];

class Writer {
	private bytes: number[] = [];

	private readonly scratch = new DataView(new ArrayBuffer(4));

	byte(value: number) {
		this.bytes.push(value & 255);
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
		for (const byte of new TextEncoder().encode(value)) this.byte(byte);
		this.byte(0);
	}

	done() {
		return new Uint8Array(this.bytes);
	}
}

export function encodeSchema(definitions: FixtureDefinition[]) {
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

type FixtureRecord = { readonly [field: string]: FixtureValue };

export type FixtureValue = KiwiValue | bigint | undefined | readonly FixtureValue[] | FixtureRecord;

const isBigInt = (value: FixtureValue): value is bigint => typeof value === "bigint";

const isFixtureRecord = (value: FixtureValue): value is FixtureRecord =>
	typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);

function encodeValue(writer: Writer, definitions: FixtureDefinition[], type: string, value: FixtureValue) {
	if (isBoolean(value) && type === "bool") return writer.byte(value ? 1 : 0);

	if (isNumber(value)) {
		if (type === "byte") return writer.byte(value);

		if (type === "int") return writer.varInt(value);

		if (type === "uint") return writer.varUint(value);

		if (type === "float") return writer.varFloat(value);
	}

	if (isBigInt(value)) return writer.varInt64(value);
	const definition = definitions.find((candidate) => candidate.name === type);

	if (isString(value) && type === "string") return writer.string(value);

	if (!definition) throw new Error(`Bad fixture value for ${type}`);

	if (definition.kind === "enum") {
		return writer.varUint(definition.fields.findIndex((field) => field === value));
	}

	if (!isFixtureRecord(value)) {
		throw new Error(`Bad fixture value for ${type}`);
	}

	definition.fields.forEach((field, i) => {
		if (isString(field)) return;
		const [name, fieldType, isArray] = field;
		const fieldValue = value[name];

		if (definition.kind === "message") {
			if (fieldValue === undefined) return;
			writer.varUint(i + 1);
		}

		if (!isArray) return encodeValue(writer, definitions, fieldType, fieldValue);

		const list = fieldValue instanceof Uint8Array ? [...fieldValue] : Array.isArray(fieldValue) ? fieldValue : [];

		writer.varUint(list.length);

		for (const item of list) encodeValue(writer, definitions, fieldType, item);
	});

	if (definition.kind === "message") writer.varUint(0);
}

export function encodeMessage(definitions: FixtureDefinition[], root: string, value: FixtureValue) {
	const writer = new Writer();

	encodeValue(writer, definitions, root, value);

	return writer.done();
}

function chunk(view: DataView, bytes: Uint8Array, offset: number) {
	view.setUint32(offset, bytes.length, true);

	return offset + 4;
}

export function figKiwi(schema: Uint8Array, data: Uint8Array, version = 70) {
	const prelude = new TextEncoder().encode("fig-kiwi");
	const out = new Uint8Array(prelude.length + 4 + 4 + schema.length + 4 + data.length);
	const view = new DataView(out.buffer);

	out.set(prelude);
	view.setUint32(prelude.length, version, true);
	let offset = chunk(view, schema, prelude.length + 4);

	out.set(schema, offset);
	offset = chunk(view, data, offset + schema.length);
	out.set(data, offset);

	return out;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export function figmaClipboardHtml(nodeChanges: FixtureValue[], options: { zstd?: boolean; version?: number } = {}) {
	const schema = deflateSync(encodeSchema(FIGMA_SCHEMA));
	const message = encodeMessage(FIGMA_SCHEMA, "Message", { type: "NODE_CHANGES", nodeChanges });
	const data = options.zstd ? Bun.zstdCompressSync(message) : deflateSync(message);
	const meta = base64(new TextEncoder().encode(JSON.stringify({ fileKey: "abc", pasteID: 1, dataType: "scene" })));

	return [
		'<meta charset="utf-8"><span data-metadata="<!--(figmeta)',
		meta,
		'(/figmeta)-->"></span><span data-buffer="<!--(figma)',
		base64(figKiwi(schema, data, options.version)),
		'(/figma)-->"></span><span style="white-space:pre-wrap;"></span>',
	].join("");
}
