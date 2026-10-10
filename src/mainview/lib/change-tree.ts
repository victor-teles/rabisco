import type { ChangedFile } from "../../shared/change-summary";

export type ChangeTreeFolder = {
	kind: "folder";
	/** Several segments when a folder holds only one folder, as in `mainview/views/editor` */
	name: string;
	path: string;
	additions: number;
	deletions: number;
	children: ChangeTreeNode[];
};

export type ChangeTreeFile = { kind: "file"; name: string; file: ChangedFile };

export type ChangeTreeNode = ChangeTreeFolder | ChangeTreeFile;

const folder = (name: string, path: string): ChangeTreeFolder => ({
	kind: "folder",
	name,
	path,
	additions: 0,
	deletions: 0,
	children: [],
});

const nodeName = (node: ChangeTreeNode) => node.name;

/** Folders first, then files, each by name */
function sortNodes(nodes: ChangeTreeNode[]) {
	nodes.sort((a, b) => (a.kind === b.kind ? nodeName(a).localeCompare(nodeName(b)) : a.kind === "folder" ? -1 : 1));

	for (const node of nodes) if (node.kind === "folder") sortNodes(node.children);
}

function collapseChains(node: ChangeTreeFolder): ChangeTreeFolder {
	let current = node;
	let only = current.children[0];

	while (current.children.length === 1 && only?.kind === "folder") {
		current = { ...only, name: `${current.name}/${only.name}` };
		only = current.children[0];
	}

	current.children = current.children.map((child) => (child.kind === "folder" ? collapseChains(child) : child));

	return current;
}

/** The changed files as a folder tree, with each folder's line counts summed */
export function changeTree(files: ChangedFile[]): ChangeTreeNode[] {
	const root = folder("", "");

	for (const file of files) {
		const segments = file.path.split("/");
		const name = segments.pop() ?? file.path;
		let parent = root;
		parent.additions += file.additions;
		parent.deletions += file.deletions;

		for (const segment of segments) {
			const path = parent.path ? `${parent.path}/${segment}` : segment;

			let next = parent.children.find(
				(child): child is ChangeTreeFolder => child.kind === "folder" && child.path === path,
			);

			if (!next) {
				next = folder(segment, path);
				parent.children.push(next);
			}

			next.additions += file.additions;
			next.deletions += file.deletions;
			parent = next;
		}

		parent.children.push({ kind: "file", name, file });
	}

	sortNodes(root.children);

	return root.children.map((child) => (child.kind === "folder" ? collapseChains(child) : child));
}

/** Every folder's path, for collapsing them all */
export function folderPaths(nodes: ChangeTreeNode[]): string[] {
	return nodes.flatMap((node) => (node.kind === "folder" ? [node.path, ...folderPaths(node.children)] : []));
}
