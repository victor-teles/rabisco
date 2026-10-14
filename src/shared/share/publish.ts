// Decision 0038
export const PUBLISH_HOSTS = ["netlify", "vercel"] as const;

export type PublishHost = (typeof PUBLISH_HOSTS)[number];

export const isPublishHost = (value: string): value is PublishHost => PUBLISH_HOSTS.some((host) => host === value);

export type PublishHostInfo = { name: string; tokenUrl: string; tokenHint: string; planHint: string };

export const PUBLISH_HOST_INFO: Record<PublishHost, PublishHostInfo> = {
	netlify: {
		name: "Netlify",
		tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
		tokenHint: "Make a personal access token with an expiry date.",
		planHint: "Netlify's free plan is enough.",
	},
	vercel: {
		name: "Vercel",
		tokenUrl: "https://vercel.com/account/settings/tokens",
		tokenHint: "Make a token with an expiry date and the Full Account scope, or a team with All Projects.",
		planHint: "Vercel's free Hobby plan is for personal, non-commercial use.",
	},
};

export const publishTokenAccount = (host: PublishHost) => `publish:${host}`;

export type PublishHostStatus = { host: PublishHost; connected: boolean };

/** Kept in app data, not in the project: it belongs to one person's host account */
export type PublishTarget = {
	host: PublishHost;
	siteId: string;
	siteName: string;
	url: string;
	publishedAt: string;
	/** sha256 of the snapshot before it is sealed */
	digest: string;
	screens: number;
	locked: boolean;
	expiresAt?: string;
};

export type PublishParams = {
	path: string;
	host: PublishHost;
	password?: string;
	expiresAt?: string;
};

export const MIN_PASSWORD_LENGTH = 8;

export const SEAL_ROUNDS = 600_000;

export type SealedSnapshot = {
	v: 1;
	kdf: "PBKDF2-SHA-256";
	rounds: number;
	salt: string;
	iv: string;
	data: string;
};

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

/** Same steps as `OPEN_SEALED_JS`, which opens it in the viewer */
export async function sealText(text: string, password: string, rounds = SEAL_ROUNDS): Promise<SealedSnapshot> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoder = new TextEncoder();

	const base = await crypto.subtle.importKey("raw", encoder.encode(password.normalize("NFC")), "PBKDF2", false, [
		"deriveKey",
	]);

	const key = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds },
		base,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	);

	const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text)));

	return { v: 1, kdf: "PBKDF2-SHA-256", rounds, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}

/** ES5 syntax for the viewer. Rejects on a wrong password. */
export const OPEN_SEALED_JS = `function openSealed(sealed, password) {
	var subtle = typeof crypto !== "undefined" && crypto.subtle;
	if (!subtle) return Promise.reject(new Error("unsupported"));
	function bytes(text) {
		var binary = atob(text);
		var out = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	}
	return subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"])
		.then(function (base) {
			return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bytes(sealed.salt), iterations: sealed.rounds }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
		})
		.then(function (key) { return subtle.decrypt({ name: "AES-GCM", iv: bytes(sealed.iv) }, key, bytes(sealed.data)); })
		.then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
}`;

export function assertPassword(password: string) {
	if (password.length < MIN_PASSWORD_LENGTH)
		throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
}

const PASSPHRASE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Four groups of four, about 79 bits */
export function generatePassphrase() {
	const size = PASSPHRASE_ALPHABET.length;
	const limit = 256 - (256 % size);
	const chars: string[] = [];

	while (chars.length < 16)
		for (const value of crypto.getRandomValues(new Uint8Array(16)))
			if (value < limit && chars.length < 16) chars.push(PASSPHRASE_ALPHABET.charAt(value % size));

	return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join("")).join("-");
}
