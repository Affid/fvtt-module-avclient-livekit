# Release files for v0.6.8-krisp.3

This branch only holds the assets for a manual GitHub release. It contains no
source code and no workflows. The source is on the branch
`claude/tender-bohr-po96zd` (commit 047f828).

| File          | Upload as release asset named |
| ------------- | ----------------------------- |
| `module.zip`  | `module.zip`                  |
| `module.json` | `module.json`                 |

Create the release at
<https://github.com/Affid/fvtt-module-avclient-livekit/releases/new>:

1. Tag: `v0.6.8-krisp.3` (create new tag on publish).
2. Title: `v0.6.8-krisp.3`.
3. Attach `module.zip` and `module.json` from this branch.
4. Leave "Set as a pre-release" unchecked and keep "Set as the latest
   release" checked, so the manifest URL
   `https://github.com/Affid/fvtt-module-avclient-livekit/releases/latest/download/module.json`
   resolves.
5. Publish.

See `RELEASING.md` on the source branch for the full process.
