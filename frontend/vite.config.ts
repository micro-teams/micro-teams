import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    // Behind a reverse proxy the app is served from whatever host the operator
    // maps in — accept any proxied Host header rather than pinning a domain.
    allowedHosts: true,
    // The page loads from the proxied origin (80/443), not :5173, so HMR would
    // otherwise dial back to the wrong origin. Set HMR_HOST to fix it for a given
    // dev setup; otherwise leave Vite's default (HMR may not reconnect behind a
    // proxy, which is tolerable). No domain is baked in.
    hmr: process.env.HMR_HOST ? { host: process.env.HMR_HOST } : undefined,
    proxy: {
      // Mirrors production nginx: /api/* -> the auth backend with the /api
      // prefix stripped (it mounts routes at /users/... directly), same
      // origin as the page so the httpOnly REFRESH_TOKEN cookie sticks.
      "/api": {
        target: process.env.AUTH_BACKEND_URL ?? "http://127.0.0.1:8091",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        // cheese-auth sets REFRESH_TOKEN with Path=/users/auth, but the browser
        // sees our requests under /api/users/auth/... — the paths don't match so
        // the cookie is never sent back on refresh and the session dies after
        // ~15 min. Rewrite the cookie path to / so it rides every /api request.
        cookiePathRewrite: "/",
      },
      "/mt": {
        target: process.env.MT_BACKEND_URL ?? "http://127.0.0.1:8199",
        changeOrigin: true,
        // ws:true so both raw WebSockets upgrade through: the 现场 viewer
        // (/mt/machine/screen/:sid) and the STOMP chat socket (/mt/ws).
        ws: true,
        rewrite: (path) => path.replace(/^\/mt/, ""),
      },
    },
  },
});
