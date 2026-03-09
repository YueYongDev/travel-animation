import {resolve} from "node:path";
import react from "@vitejs/plugin-react";
import {defineConfig, loadEnv} from "vite";

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), "index.html"),
          terms: resolve(process.cwd(), "terms.html"),
          privacy: resolve(process.cwd(), "privacy.html"),
          workspace: resolve(process.cwd(), "workspace/index.html"),
        },
      },
    },
    define: {
      "process.env.REMOTION_MAPBOX_TOKEN": JSON.stringify(
        env.REMOTION_MAPBOX_TOKEN || "",
      ),
    },
    plugins: [react()],
  };
});
