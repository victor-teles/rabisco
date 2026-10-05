import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { transform } from "sucrase";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export const tempDir = (prefix = "rabisco-test-") => mkdtempSync(join(tmpdir(), prefix));

/** The same transform the webview uses (decision 0001). Throws on syntax errors. */
export const compileTsx = (source: string) => transform(source, { transforms: ["typescript", "jsx"] }).code;

/** The CommonJS module a compiled screen fills in. */
type ScreenModule = { exports: { default?: () => ReactNode } };

/** Renders a self-contained screen (no imports besides React) to HTML. */
export function renderScreen(source: string) {
	const { code } = transform(source, { transforms: ["typescript", "jsx", "imports"], production: true });
	const module: ScreenModule = { exports: {} };
	new Function("module", "exports", "React", code)(module, module.exports, React);
	const Screen = module.exports.default;

	if (!Screen) throw new Error("The screen has no default export");

	return renderToStaticMarkup(createElement(Screen));
}
