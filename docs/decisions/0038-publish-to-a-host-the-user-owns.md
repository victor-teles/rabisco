# 0038 · Publish the exported website to a host the user owns, with a token in the keychain; a password encrypts the snapshot in the browser

- **Status:** proposed
- **Date:** 2026-10-13
- **Extends:** [0008](./0008-share-link-and-git-sync.md)
- **Code:** not built yet. The build is Phase 23 in [`docs/ROADMAP.md`](../ROADMAP.md).

## Context

The share link from [0008](./0008-share-link-and-git-sync.md) works only on the local network, and only while Rabisco is open. MagicPath, Banani and Paper give a public link that needs no account. Phase 23 asks for a link that a stakeholder can open on a phone, anywhere.

"Export as website…" already writes the viewer as a static site: `index.html`, `viewer.js`, `snapshot.js` and `runtime/frame.html`. All paths are relative, so the site works at a domain root, under a subpath and from `file://`. All design content is in `snapshot.js`. The other files hold only the viewer and the screen runtime.

These rules stay:

- Rabisco has no server and no accounts. The app works with no account and no AI.
- Credentials stay in the keychain (`SecretStore`, `src/bun/ai/keychain.ts`) and never go into project files.
- Screens stay sandboxed. `frame.html` keeps `sandbox="allow-scripts"`.

## Decision

**Publish uploads the same files as "Export as website" to a static host the user owns.** Rabisco runs no server and stores nothing outside the user's computer and the user's host.

### Hosts

| Host             | First release | How                                                                   |
| ---------------- | ------------- | --------------------------------------------------------------------- |
| Netlify          | yes           | REST API with a personal access token                                 |
| Vercel           | yes           | REST API with an access token                                         |
| GitHub Pages     | second step   | The system `git`, as in git sync. No token in Rabisco                 |
| Cloudflare Pages | later         | Its upload path is the `wrangler` flow, not a stable public API. Wait |

- **API, not the host CLIs.** `netlify` and `vercel` need Node, an interactive login and a version we don't control. A packaged app can't count on them. The APIs need only `fetch` from the main process, and tests can replace `fetch` with a fake.
- **Netlify:** create a site with a random name once, then deploy a zip of the files to it. **Vercel:** create a deployment with the files inline, under a project with a random name, and alias it to the project's production URL so the link stays the same.
- **GitHub Pages:** push the files to a `gh-pages` branch of a remote the user picks, with the code in `src/bun/git.ts`. The push is never forced: Rabisco fetches the branch, commits the new files on top and pushes. If the branch has commits that Rabisco didn't make (no `.rabisco-publish` marker file), Rabisco refuses. The user turns on Pages for the branch once in the repository settings. Rabisco shows the expected URL and links to that page.
- **One host per project.** "Publish" deploys again to the same site, so the URL stays the same, like "Update link" in 0008.

### Tokens and settings

- **The token goes in the keychain**, under the account `publish:<host>` (for example `publish:netlify`). It goes to the host API only, from the main process, and never reaches the webview after the user types it.
- **The publish target goes in app data, not in the project.** It holds the host, the site id, the URL, the time of the last publish and a digest of the files. A target belongs to one person's host account, so a teammate who pulls the project doesn't get it. App data is the same place as saved history ([0024](./0024-history-in-app-data.md)), keyed the same way.
- **Connect** asks for a token and checks it with one read-only API call before saving it. It links to the host's token page and says which scope to choose. Both hosts give account-wide tokens, so Rabisco tells the user to set an expiry on the token.
- **Disconnect** deletes the token. It doesn't delete published sites.

### Password

A static host can't check a password on the server. So **a password encrypts the snapshot, and the viewer decrypts it in the browser.**

- Rabisco derives a key from the password with PBKDF2-SHA-256 (600,000 rounds, a random 16-byte salt) and encrypts the snapshot JSON with AES-256-GCM. `snapshot.js` then holds only the salt, the IV, the round count and the ciphertext.
- The viewer asks for the password, decrypts with WebCrypto and starts as before. A wrong password says "Wrong password" and lets the user try again. The frame and the runtime don't change, because the runtime has no design content.
- The password is not saved anywhere. Rabisco asks for it at each publish while the password is on.

What it protects against:

- People who get the URL but not the password. They can't see the screens, the code or the images.
- The host and anyone with access to the host account's files. They see only ciphertext.
- Search engines. They find nothing to index. Every published site also gets `<meta name="robots" content="noindex">` and a random site name.

What it doesn't protect against:

- **Guessing offline.** Anyone with the URL can download the ciphertext and try passwords on their own computer. The rounds make each guess slow, but a short password falls. Rabisco requires at least 8 characters and suggests a generated passphrase.
- **A shared password.** Anyone with the password can pass it on, or copy the decrypted design. There is no list of who may view.
- **Revoking access.** To change the password, publish again with a new one. Old copies that someone downloaded stay readable with the old password.

Access rules that the host enforces (Vercel and Netlify password protection, Cloudflare Access) are on paid plans or need extra setup. They aren't in the first release. A user who has them can still turn them on in the host.

### Expiry

A static host can't expire a page by itself either. So **expiry is two things, and the UI says both:**

1. **The viewer stops at the date.** After the expiry date the viewer shows "This link has expired" and doesn't load the screens. This is a soft stop: anyone who reads `snapshot.js` can still get the design, unless a password is set.
2. **Rabisco takes the site down.** The first time Rabisco runs after the date, it deletes the site (Netlify, Vercel) or replaces the `gh-pages` files with an "expired" page (GitHub Pages). If Rabisco doesn't run, the site stays up until it does.

The expiry picker says: "The link stops working on this date. Rabisco removes the site the next time it runs after it."

### Viewer comments

**Comments from viewers stay on the local network for now** ([LIT-40](/LIT/issues/LIT-40)). The LAN share server gets one new route: a POST, behind the same token, that takes a plain-text comment with a screen and a pin position. The comment arrives in the project as an undoable change and shows as a new comment thread. A published site has no comment button in the first release.

The later path for a published link, with no Rabisco server: the viewer lets a stakeholder place pins and copy them as one block of text. They send it by any channel. The designer pastes it on the canvas, and Rabisco adds the comments in one undo step. A relay that collects comments for the designer would be a hosted Rabisco service, which needs a new decision and the board.

### No account

Publishing is never a dead end. With no host connected, the Share popover shows:

- **Share on your network:** the LAN link from 0008, with a QR code to open it on a phone.
- **Publish to the web:** the hosts, each with "Connect" and a one-line guide to get a free account and a token.
- **Export as website…**, with a line that says the folder works on any static host and can be dragged onto a host's upload page.

Nothing in the editor needs a host account. Publish is only one more button next to these.

## Why

- **No Rabisco server, no Rabisco account.** The user's host serves the link, on the user's account, at no cost to us and with nothing to keep running.
- **The same files as the export.** One viewer, tested once. What a stakeholder sees on the web is what the LAN link and the canvas show ([principle 3](../PRINCIPLES.md#3-screens-are-react)).
- **Tokens in the keychain** follow principle 4 and the provider keys: credentials stay on the machine.
- **Encryption in the browser** gives a real password on every static host, free, and keeps the design away from the host. Its limits are known and we say them in the UI.
- **Netlify and Vercel first** because each needs one token and gives a working URL within seconds. GitHub Pages reuses git sync but needs a setup step and a delay before the site is live.

## Consequences

- A published design is on the public internet at an unlisted URL. Without a password, anyone with the URL can read the screens and their TSX source (0008 already says the snapshot has the source).
- Host tokens are account-wide. A token stolen from the keychain can change any site on that account. The build needs a security review before it ships.
- Big projects make big uploads, because images are `data:` URLs in `snapshot.js` (0010). Hosts limit file size (Vercel inline files, for example). The build splits images out of the snapshot when a host needs it, or says which limit was hit.
- Expiry depends on Rabisco running. The UI must not claim more than that.
- The publish target is in app data. A moved project folder follows the same rule as saved history ([0034](./0034-history-follows-moves-and-keeps-images.md)).
- Signing in with OAuth ("Connect with Vercel") would need an OAuth app owned by the company. That needs the board and a new decision. Tokens need neither.
