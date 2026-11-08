import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * `npm run dev:phone` serves over HTTPS on the LAN so a real phone can open the camera:
 * browsers expose getUserMedia only in a secure context, and a LAN IP over plain HTTP is
 * not one (localhost is exempt). The certificate is self-signed, so the phone shows a
 * one-time warning to accept. Never used for the production build.
 */
const phone = process.env.DUNIALAB_HTTPS === "1";

export default defineConfig({
  plugins: [react(), ...(phone ? [basicSsl()] : [])],
  server: { port: 5173, ...(phone ? { host: true } : {}) },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["test/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
