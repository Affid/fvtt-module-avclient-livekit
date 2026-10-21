# Releasing

Releases of this fork are published by hand on GitHub's Releases page. No
GitHub Actions workflow is involved (the old automatic workflow is parked in
`.github/disabled-workflows/` and never runs).

Every release has two assets:

- `module.zip`: the contents of the built `dist/` folder, with `module.json`
  at the root of the zip (not inside a subfolder).
- `module.json`: the same manifest file, uploaded on its own. Foundry reads
  it from `releases/latest/download/module.json` to find updates.

## 1. Bump the version

Pick the next version. Keep the `-krisp.N` suffix so it can never clash with
an upstream release: `0.6.8-krisp.1` → `0.6.8-krisp.2`, or, after merging a
new upstream release such as 0.6.9, `0.6.9-krisp.1`.

In `module.json`, update **both** of these to the new version:

```json
"version": "0.6.8-krisp.2",
"download": "https://github.com/Affid/fvtt-module-avclient-livekit/releases/download/v0.6.8-krisp.2/module.zip",
```

The version in `"download"` must match `"version"`, with a leading `v`.
Add a matching section to `CHANGELOG.md`, then commit.

## 2. Build

You need Node.js 22 or newer and pnpm (`corepack enable` sets it up from
`package.json`).

```sh
pnpm install --frozen-lockfile
pnpm run build
```

This writes the module to `dist/`, including `module.json`, the noise model
WASM/worklet files (`gtcrn/`, `rnnoise/`, `speex/`, `noise-suppressor/`), and
the lazily loaded `krisp-noise-filter-*.js` chunk.

## 3. Package

Zip the **contents** of `dist/` (not the folder itself), and copy the
manifest next to it:

```sh
rm -f module.zip
(cd dist && zip -r ../module.zip .)
cp dist/module.json module.json.release
```

On Windows, use PowerShell 7 or newer (`pwsh`). The older Windows
PowerShell 5.1 writes `\` path separators into the zip, which breaks
installation on Foundry servers running on Linux.

```powershell
Remove-Item module.zip -ErrorAction Ignore
Compress-Archive -Path dist\* -DestinationPath module.zip
Copy-Item dist\module.json module.json.release
```

Check the result: `module.json` must be at the root of the zip, and the
version inside must match the one you are releasing.

```sh
unzip -l module.zip | grep -E ' (module\.json|avclient-livekit\.js)$'
unzip -p module.zip module.json | grep '"version"'
```

## 4. Create the release on GitHub

1. Push your commits, then open
   <https://github.com/Affid/fvtt-module-avclient-livekit/releases/new>.
2. **Choose a tag**: type the new tag, e.g. `v0.6.8-krisp.2`, and pick
   "Create new tag on publish". Set the target to the branch you built from.
3. **Release title**: e.g. `v0.6.8-krisp.2`. Paste the changelog section as
   the description.
4. **Attach binaries**: upload `module.zip`, and upload
   `module.json.release` renamed to **`module.json`** (rename the file before
   uploading; GitHub uses the file name as the asset name).
5. Leave **"Set as a pre-release" unchecked** and keep **"Set as the latest
   release"** checked. The manifest URL
   (`releases/latest/download/module.json`) only follows the latest
   non-pre-release, so Foundry won't see a pre-release.
6. Click **Publish release**.

## 5. Check it

- <https://github.com/Affid/fvtt-module-avclient-livekit/releases/latest/download/module.json>
  should download the new manifest with the new version.
- The `download` URL inside it should download `module.zip`.
- In Foundry, install or update with the manifest URL
  `https://github.com/Affid/fvtt-module-avclient-livekit/releases/latest/download/module.json`.
