// Sucrase ships types for its parser under dist/types, but not next to the ESM build we import.
declare module "sucrase/dist/esm/parser" {
	export * from "sucrase/dist/types/parser/index";
}

declare module "sucrase/dist/esm/parser/tokenizer/types" {
	export * from "sucrase/dist/types/parser/tokenizer/types";
}
