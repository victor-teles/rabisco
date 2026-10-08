// Decision 0011. Agents get the attached images as files in their staging directory.

import type { Attachment, GenerationRequest } from "../../shared/ai/contract";

/** Hidden, so the staging diff never reports the images as changes */
export const ATTACHMENT_DIR = ".rabisco/attachments";

const EXTENSIONS: Record<Attachment["mediaType"], string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

export type StagedAttachment = {
	/** Relative to the staging directory, forward slashes */
	path: string;
	attachment: Attachment;
};

function stemOf(name: string) {
	const stem = name
		.replace(/\.[^.]*$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

	return stem || "image";
}

/** Numbered, so two images with one name stay apart */
export function stagedAttachments(request: GenerationRequest): StagedAttachment[] {
	return (request.attachments ?? []).map((attachment, index) => ({
		path: `${ATTACHMENT_DIR}/${index + 1}-${stemOf(attachment.name)}.${EXTENSIONS[attachment.mediaType]}`,
		attachment,
	}));
}
