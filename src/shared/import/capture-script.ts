import { INHERITED_PROPERTIES, MAX_CAPTURED_NODES, STYLE_PROPERTIES } from "./captured-tree";

export const INITIAL_STYLES = {
	position: ["static"],
	top: ["auto"],
	right: ["auto"],
	bottom: ["auto"],
	left: ["auto"],
	"z-index": ["auto"],
	"flex-direction": ["row"],
	"flex-wrap": ["nowrap"],
	"justify-content": ["normal"],
	"align-items": ["normal"],
	"align-self": ["auto"],
	"flex-grow": ["0"],
	"flex-shrink": ["1"],
	"flex-basis": ["auto"],
	"row-gap": ["normal", "0px"],
	"column-gap": ["normal", "0px"],
	"grid-template-columns": ["none"],
	"overflow-x": ["visible"],
	"overflow-y": ["visible"],
	"min-width": ["auto", "0px"],
	"max-width": ["none"],
	"min-height": ["auto", "0px"],
	"max-height": ["none"],
	"background-color": ["rgba(0, 0, 0, 0)", "transparent"],
	"background-image": ["none"],
	"box-shadow": ["none"],
	opacity: ["1"],
	"object-fit": ["fill"],
	"text-decoration-line": ["none"],
} satisfies Record<string, string[]>;

export const ROOT_INHERITED = {
	color: "rgb(0, 0, 0)",
	"font-size": "16px",
	"font-weight": "400",
	"font-style": "normal",
	"line-height": "normal",
	"letter-spacing": "normal",
	"text-align": "start",
	"text-transform": "none",
	"white-space": "normal",
	"list-style-type": "disc",
} satisfies Record<string, string>;

const config = JSON.stringify({
	own: STYLE_PROPERTIES,
	inherited: INHERITED_PROPERTIES,
	initial: INITIAL_STYLES,
	root: ROOT_INHERITED,
	max: MAX_CAPTURED_NODES,
});

const script = String.raw`
const config = ${config};
const DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "template", "noscript", "head", "title", "base"]);
const REPLACED = new Set(["img", "svg", "canvas", "video", "input", "textarea", "select", "hr", "br"]);
const MEDIA = new Set(["img", "svg", "canvas", "video"]);
const BLOCK = /^(block|flex|grid|table|list-item|flow-root)/;
const SVG_ATTRS = /^(viewBox|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|fill-rule|clip-rule|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|transform|opacity|xmlns)$/;
const root = document.body;
const origin = root.getBoundingClientRect();
let count = 0;
const boxOf = (rect) => ({ x: Math.round(rect.left - origin.left), y: Math.round(rect.top - origin.top), width: Math.round(rect.width), height: Math.round(rect.height) });
const px = (value) => parseFloat(value) || 0;
const safeUrl = (url) => !/^\s*(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp|avif);))/i.test(url);
function ownStyles(element, computed) {
	const styles = {};
	for (const name of config.own) {
		if (name === "width" || name === "height") continue;
		const value = computed.getPropertyValue(name);
		if (!value || (config.initial[name] || ["0px"]).includes(value)) continue;
		styles[name] = value;
	}
	for (const side of ["top", "right", "bottom", "left"]) {
		if (styles["border-" + side + "-style"] && px(styles["border-" + side + "-width"]) > 0) continue;
		delete styles["border-" + side + "-style"];
		delete styles["border-" + side + "-width"];
		delete styles["border-" + side + "-color"];
	}
	if (!styles["border-top-style"] && !styles["border-right-style"] && !styles["border-bottom-style"] && !styles["border-left-style"]) {
		for (const side of ["top", "right", "bottom", "left"]) delete styles["border-" + side + "-color"];
	}
	if (element.style.marginLeft === "auto") styles["margin-left"] = "auto";
	if (element.style.marginRight === "auto") styles["margin-right"] = "auto";
	const left = styles["margin-left"], right = styles["margin-right"];
	if (left && left === right && px(left) > 0 && styles["max-width"] && BLOCK.test(computed.display)) {
		styles["margin-left"] = "auto";
		styles["margin-right"] = "auto";
	}
	if (MEDIA.has(element.localName) || computed.position === "absolute" || computed.position === "fixed") {
		const rect = element.getBoundingClientRect();
		styles.width = Math.round(rect.width) + "px";
		styles.height = Math.round(rect.height) + "px";
	}
	if (styles["background-image"] && !/gradient\(/.test(styles["background-image"])) delete styles["background-image"];
	return styles;
}
function inheritedStyles(computed, parent) {
	const styles = {};
	for (const name of config.inherited) {
		const value = computed.getPropertyValue(name);
		const base = parent ? parent.getPropertyValue(name) : config.root[name];
		if (value && value !== base) styles[name] = value;
	}
	return styles;
}
function attributesOf(element, tag) {
	const attrs = {};
	const keep = (name, value) => { if (value != null && value !== "") attrs[name] = String(value); };
	if (tag === "a" && element.getAttribute("href") && safeUrl(element.getAttribute("href"))) keep("href", element.getAttribute("href"));
	if (tag === "img") {
		const src = element.getAttribute("src");
		if (src && safeUrl(src)) keep("src", src);
		keep("alt", element.getAttribute("alt"));
	}
	if (tag === "input" || tag === "textarea" || tag === "button") {
		keep("type", element.getAttribute("type"));
		keep("placeholder", element.getAttribute("placeholder"));
		if (tag === "input" && element.type !== "password") keep("value", element.getAttribute("value"));
		if (element.hasAttribute("checked")) keep("checked", "true");
		if (element.hasAttribute("disabled")) keep("disabled", "true");
	}
	for (const name of ["title", "role", "for", "colspan", "rowspan"]) keep(name, element.getAttribute(name));
	for (const attr of element.attributes) if (/^aria-[a-z]+$/.test(attr.name)) keep(attr.name, attr.value);
	return attrs;
}
function svgNode(element) {
	if (count >= config.max) return null;
	count++;
	const attrs = {};
	for (const attr of element.attributes) if (SVG_ATTRS.test(attr.name) && !/url\(|javascript:/i.test(attr.value)) attrs[attr.name] = attr.value;
	const children = [];
	for (const child of element.children) {
		const node = svgNode(child);
		if (node) children.push(node);
	}
	return { tag: element.localName, box: boxOf(element.getBoundingClientRect()), styles: {}, attrs, children };
}
function textNode(node, computed) {
	let text = node.textContent || "";
	if (!/^pre/.test(computed.whiteSpace)) text = text.replace(/[\t\n\r ]+/g, " ");
	if (!text) return null;
	const range = document.createRange();
	range.selectNodeContents(node);
	return { tag: "#text", text, box: boxOf(range.getBoundingClientRect()), styles: {}, children: [] };
}
function childrenOf(element, computed) {
	const children = [];
	for (const child of element.childNodes) {
		if (count >= config.max) break;
		if (child.nodeType === 3) {
			const node = textNode(child, computed);
			if (node) {
				count++;
				children.push(node);
			}
		} else if (child.nodeType === 1) {
			const style = getComputedStyle(child);
			if (style.display === "contents") children.push(...childrenOf(child, computed));
			else {
				const node = elementNode(child, computed);
				if (node) children.push(node);
			}
		}
	}
	const flow = !/flex|grid/.test(computed.display);
	return children.filter((node, i) => {
		if (node.tag !== "#text" || node.text.trim()) return true;
		if (!flow) return false;
		const blockAt = (j) => j < 0 || j >= children.length || (children[j].tag !== "#text" && BLOCK.test(children[j].styles.display || ""));
		return !blockAt(i - 1) && !blockAt(i + 1);
	});
}
function elementNode(element, parent) {
	let tag = element.localName;
	if (DROP.has(tag) || count >= config.max) return null;
	const computed = getComputedStyle(element);
	if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse") return null;
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0 && !REPLACED.has(tag) && computed.position !== "absolute" && computed.position !== "fixed") return null;
	if (tag === "svg") {
		const node = svgNode(element);
		if (node) node.styles = Object.assign(ownStyles(element, computed), inheritedStyles(computed, parent));
		return node;
	}
	count++;
	if (tag === "canvas" || tag === "video") tag = "img";
	const node = { tag, box: boxOf(rect), styles: Object.assign(ownStyles(element, computed), inheritedStyles(computed, parent)), attrs: attributesOf(element, tag), children: [] };
	if (tag !== "img" && tag !== "textarea" && tag !== "select") node.children = childrenOf(element, computed);
	if (tag === "textarea" && element.value) node.children = [{ tag: "#text", text: element.value, box: node.box, styles: {}, children: [] }];
	return node;
}
const computed = getComputedStyle(root);
const body = { tag: "body", box: boxOf(origin), styles: Object.assign(ownStyles(root, computed), inheritedStyles(computed, null)), children: [] };
body.styles["font-family"] = computed.fontFamily;
if (!body.styles["background-color"]) {
	const page = getComputedStyle(document.documentElement).backgroundColor;
	if (page && !config.initial["background-color"].includes(page)) body.styles["background-color"] = page;
}
delete body.styles["margin-top"]; delete body.styles["margin-right"]; delete body.styles["margin-bottom"]; delete body.styles["margin-left"];
body.children = childrenOf(root, computed);
return JSON.stringify({ title: document.title || "", width: Math.round(origin.width), root: body });
`;

export const CAPTURE_SCRIPT = `(() => {${script}})()`;
