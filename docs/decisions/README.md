# Decisions

Architecture decision records. Each one states the context, the decision, the evidence and the consequences. To change a decision, add a new record that supersedes the old one.

| #                                                  | Decision                                                                                                             | Status   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| [0001](./0001-compile-tsx-in-the-webview.md)       | Compile screen TSX in the webview, with Sucrase                                                                      | accepted |
| [0002](./0002-incremental-tailwind-in-the-host.md) | Build Tailwind CSS incrementally in the webview host, and share it with every frame                                  | accepted |
| [0003](./0003-ai-provider-contract.md)             | AI provider contract: providers write files                                                                          | accepted |
| [0004](./0004-alternates-are-files.md)             | Variations and alternates are files                                                                                  | accepted |
| [0005](./0005-rpc-round-trip-floor.md)             | The ~17.5 ms RPC round trip is a 16 ms poll in the main process; push, batch and keep requests off hot paths         | accepted |
| [0006](./0006-components-from-source.md)           | Component tools read the TSX source (Sucrase tokens), not the rendered DOM                                           | accepted |
| [0007](./0007-prototype-links-in-source.md)        | Prototype links are a `data-link-to` attribute in the TSX; play mode is a frame mode                                 | accepted |
| [0008](./0008-share-link-and-git-sync.md)          | Share links are a static viewer served on the local network; git sync runs the git CLI, scoped to the project folder | accepted |
