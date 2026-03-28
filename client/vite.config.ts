import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  server: {
    proxy: {
      "/upload": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
