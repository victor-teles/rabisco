# 0043 · Publish to GitHub Pages through the git sync remote, on a branch of its own, and never delete or rewrite it

- **Status:** accepted
- **Date:** 2026-10-14
- **Extends:** [0038](./0038-publish-to-a-host-the-user-owns.md), [0008](./0008-share-link-and-git-sync.md)
- **Code:** [`src/bun/publish-pages.ts`](../../src/bun/publish-pages.ts), [`src/bun/publish.ts`](../../src/bun/publish.ts), [`src/mainview/views/editor/export/publish-section.tsx`](../../src/mainview/views/editor/export/publish-section.tsx)

## Context

0038 names GitHub Pages as the second step: push the website export to a `gh-pages` branch with the system `git`, never forced, and refuse a branch that Rabisco didn't make. It leaves some details open: which remote, how to write the branch without touching the project, what "remove" means for a branch, and what a user without git sync sees.

## Decision

**GitHub Pages is the third host in the Web tab.** Publish, update, remove, password and expiry work as they do for Netlify and Vercel. The differences:

- **The remote is the project's git sync remote.** Rabisco doesn't ask for another one. It reads the remote URL as the user typed it (before `insteadOf`), and it must be on `github.com`. The Pages URL comes from it: `https://<owner>.github.io/<repo>/`, or the root for a repository named `<owner>.github.io`.
- **No token.** The push uses the user's own git credentials, as git sync does. Nothing goes in the keychain, and there is no Connect or Disconnect.
- **The branch is `gh-pages` unless the user types another one** before the first publish. Later publishes use the same branch, so the URL stays the same. Rabisco refuses the branch the project itself is on.
- **The project stays as it is.** Rabisco writes the site with a scratch index (`GIT_INDEX_FILE`) and a scratch work tree in the temp folder, then `write-tree`, `commit-tree` and `push <commit>:refs/heads/<branch>`. The project's branch, index and working tree don't change, and nothing is checked out.
- **Never forced.** Rabisco reads the branch tip with `ls-remote`, fetches it and commits on top. If someone pushed in between, the push is rejected and Rabisco says "Publish again".
- **The marker says which project.** `.rabisco-publish` holds `{"project": "<folder in the repository>"}`. Rabisco refuses a branch with no marker, or with another project's marker, so two projects in one repository can't overwrite each other's site.
- **`.nojekyll`** goes with every publish, so Pages serves the files as they are. A `CNAME` file on the branch (GitHub's custom domain setting) is kept; everything else is replaced.
- **Remove and expiry replace the files, they don't delete the branch.** The site becomes a short page: "This site was removed" or "This link has expired". Deleting a remote branch is the kind of destructive git action Rabisco never takes on its own ([0008](./0008-share-link-and-git-sync.md)). The sweep finds the project folder from the path that the target in app data already keeps.
- **No account is a next step, not a dead end.** Without a repository, a remote or a GitHub remote, the Web tab says what is missing and has a "Set up git sync" button that opens the Git tab.
- **The user turns on Pages once.** Rabisco shows the expected URL and links to the repository's Pages settings. GitHub can take a minute to show a new version.

## Why

- **Git sync already has the remote and the credentials.** A second remote or a GitHub token would be one more thing to set up and keep safe.
- **A scratch index** is git's own way to build a commit off to the side. The user can be in the middle of anything in the project, and publishing doesn't touch it.
- **Replacing instead of deleting** keeps every action a fast-forward push, which is easy to undo and never loses someone's work.

## Consequences

- **History stays.** Earlier versions of the site stay in the branch's history. Anyone who can read the repository can read them, and the project's own files on its main branch. A password protects the published site, not the repository. The Web tab says so before the first publish.
- **Free Pages needs a public repository.** On GitHub's free plan the project's source is then public too. Private repositories with Pages need a paid plan.
- **No response headers.** Pages can't set `X-Robots-Tag` or the `sandbox` CSP on `runtime/`. The `noindex` meta tag in `index.html` and `sandbox="allow-scripts"` on the frame still apply.
- **Expiry needs Rabisco and the project folder.** If the folder moved or was deleted, the sweep can't reach the branch and tries again at its next run, as it does for a missing token.
- Every publish leaves a few objects in the user's repository that no local branch points to. `git gc` removes them.
