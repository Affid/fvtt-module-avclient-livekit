import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import checker from "vite-plugin-checker";
import fs from "fs/promises";
import path from "path";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "/modules/avclient-livekit/",
  build: {
    lib: {
      entry: resolve(__dirname, "src/avclient-livekit.ts"),
      name: "avclient-livekit",
      fileName: "avclient-livekit",
      formats: ["es"],
    },
    rolldownOptions: {
      output: {
        // Name the lazily loaded Krisp chunk clearly instead of "dist-<hash>"
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes("krisp-noise-filter"))
            ? "krisp-noise-filter-[hash].js"
            : "[name]-[hash].js",
      },
    },
    sourcemap: true,
  },
  plugins: [
    // Foundry expands dotted translation keys into nested objects, and drops
    // the whole language file if a key is both a string and a parent of other
    // keys (e.g. "A.b" and "A.b.c"). Fail the build instead.
    {
      name: "validate-language-files",
      buildStart: async function () {
        const langDir = resolve(__dirname, "public/lang");
        for (const file of await fs.readdir(langDir)) {
          const keys = Object.keys(
            JSON.parse(
              await fs.readFile(path.join(langDir, file), "utf8"),
            ) as Record<string, unknown>,
          );
          const conflicts = keys.filter((key) =>
            keys.some((other) => other.startsWith(`${key}.`)),
          );
          if (conflicts.length) {
            this.error(
              `lang/${file}: keys used both as a string and as a group: ${conflicts.join(", ")}`,
            );
          }
        }
      },
    },
    basicSsl(),
    checker({
      eslint: {
        lintCommand: "eslint",
        useFlatConfig: true,
      },
      typescript: true,
    }),
    viteStaticCopy({
      targets: [
        {
          src: "CHANGELOG.md",
          dest: "",
        },
        {
          src: "LICENSE*",
          dest: "",
        },
        {
          src: "THIRD-PARTY-NOTICES.md",
          dest: "",
        },
        {
          src: "README.md",
          dest: "",
        },
        {
          src: "module.json",
          dest: "",
        },
      ],
    }),
    // During development, copy all files from the public directory to the build output directory
    // https://stackoverflow.com/questions/71040714/write-to-disk-option-for-vite/72695336#72695336
    {
      name: "write-to-disk",
      apply: "serve",
      configResolved: async (config) => {
        config.logger.info("Writing contents of public folder to disk", {
          timestamp: true,
        });
        await fs.cp(config.publicDir, config.build.outDir, { recursive: true });
      },
      handleHotUpdate: async ({ file, server: { config, ws }, read }) => {
        if (path.dirname(file).startsWith(config.publicDir)) {
          const destPath = path.join(
            config.build.outDir,
            path.relative(config.publicDir, file),
          );
          config.logger.info(`Writing contents of ${file} to disk`, {
            timestamp: true,
          });
          await fs
            .access(path.dirname(destPath))
            .catch(() => fs.mkdir(path.dirname(destPath), { recursive: true }));
          await fs.writeFile(destPath, await read());
          // Notify the client to reload the page
          ws.send({ type: "full-reload" });
        }
      },
    },
  ],
  server: {
    port: 30001,
    proxy: {
      "^(?!/modules/avclient-livekit/)": `http://localhost:30000/`,
      "/socket.io": {
        target: `ws://localhost:30000`,
        ws: true,
      },
    },
  },
});
