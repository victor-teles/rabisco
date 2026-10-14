import { deflateSync } from "fflate";
import {
	encodeMessage,
	encodeSchema,
	enumOf,
	figKiwi,
	type SchemaDefinition,
	type WriteValue,
} from "../../export/figma/kiwi-writer";

export { encodeMessage, encodeSchema, figKiwi };

export type FixtureValue = WriteValue;

export const FIGMA_SCHEMA: SchemaDefinition[] = [
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
		base64(figKiwi(schema, data, options.version ?? 70)),
		'(/figma)-->"></span><span style="white-space:pre-wrap;"></span>',
	].join("");
}
