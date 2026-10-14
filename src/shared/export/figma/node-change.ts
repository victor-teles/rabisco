export type Guid = { sessionID: number; localID: number };

export type FigmaColor = { r: number; g: number; b: number; a: number };

export type FigmaMatrix = { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };

export type FigmaNumber = { value: number; units: "RAW" | "PIXELS" | "PERCENT" };

export type FigmaPaint = {
	type: "SOLID" | "GRADIENT_LINEAR" | "IMAGE";
	color?: FigmaColor;
	opacity: number;
	visible: boolean;
	blendMode: "NORMAL";
	stops?: { color: FigmaColor; position: number }[];
	transform?: FigmaMatrix;
	image?: { hash: Uint8Array; name: string; dataBlob: number };
	imageScaleMode?: string;
	originalImageWidth?: number;
	originalImageHeight?: number;
};

export type FigmaEffect = {
	type: "INNER_SHADOW" | "DROP_SHADOW";
	color: FigmaColor;
	offset: { x: number; y: number };
	radius: number;
	spread: number;
	visible: boolean;
	blendMode: "NORMAL";
	showShadowBehindNode: boolean;
};

export type FigmaFont = { family: string; style: string; postscript: string };

export type TextFields = {
	fontName?: FigmaFont;
	fontSize?: number;
	fillPaints?: FigmaPaint[];
	textDecoration?: string;
	letterSpacing?: FigmaNumber;
	lineHeight?: FigmaNumber;
};

export type NodeFields = TextFields & {
	guid?: Guid;
	phase?: "CREATED";
	parentIndex?: { guid: Guid; position: string };
	type?: string;
	name?: string;
	visible?: boolean;
	opacity?: number;
	blendMode?: string;
	size?: { x: number; y: number };
	transform?: FigmaMatrix;
	styleID?: number;
	strokePaints?: FigmaPaint[];
	strokeWeight?: number;
	strokeAlign?: string;
	strokeCap?: string;
	strokeJoin?: string;
	borderStrokeWeightsIndependent?: boolean;
	borderTopWeight?: number;
	borderRightWeight?: number;
	borderBottomWeight?: number;
	borderLeftWeight?: number;
	cornerRadius?: number;
	rectangleTopLeftCornerRadius?: number;
	rectangleTopRightCornerRadius?: number;
	rectangleBottomRightCornerRadius?: number;
	rectangleBottomLeftCornerRadius?: number;
	rectangleCornerRadiiIndependent?: boolean;
	effects?: FigmaEffect[];
	frameMaskDisabled?: boolean;
	horizontalConstraint?: string;
	verticalConstraint?: string;
	stackMode?: "HORIZONTAL" | "VERTICAL";
	stackSpacing?: number;
	stackCounterSpacing?: number;
	stackHorizontalPadding?: number;
	stackVerticalPadding?: number;
	stackPaddingRight?: number;
	stackPaddingBottom?: number;
	stackPrimarySizing?: string;
	stackCounterSizing?: string;
	stackPrimaryAlignItems?: string;
	stackCounterAlignItems?: string;
	stackChildPrimaryGrow?: number;
	stackChildAlignSelf?: string;
	stackPositioning?: string;
	stackWrap?: string;
	textData?: { characters: string; characterStyleIDs?: number[]; styleOverrideTable?: NodeFields[] };
	textAlignHorizontal?: string;
	textAlignVertical?: string;
	textAutoResize?: string;
	textCase?: string;
	textTruncation?: string;
	maxLines?: number;
	derivedTextData?: {
		glyphs: { commandsBlob: number; position: { x: number; y: number }; fontSize: number; advance: number }[];
	};
	vectorData?: { vectorNetworkBlob: number; normalizedSize: { x: number; y: number } };
	fillGeometry?: { windingRule: string; commandsBlob: number; styleID: number }[];
};
