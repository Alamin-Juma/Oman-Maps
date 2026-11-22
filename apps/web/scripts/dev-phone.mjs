/**
 * Dev server for testing on a real phone (camera, Tier B scan-and-pop).
 *
 * The camera API exists only in a secure context, and a LAN IP over plain HTTP is not one,
 * so this serves HTTPS with a self-signed certificate (accept the one-time phone warning).
 * Prints the LAN URLs to type on the phone, and the camera-check deep link.
 *
 * Usage: npm run dev:phone -w @dunialab/web    (or: npm run dev:phone)
 */
import { networkInterfaces } from "node:os";
import { createServer } from "vite";
import { listeningPort } from "./listening-port.mjs";

process.env.DUNIALAB_HTTPS = "1";

const server = await createServer({ server: { port: 5173, host: true } });
await server.listen();

const port = listeningPort(server);
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);

console.log("\n  DuniaLab dev server (HTTPS, self-signed certificate)\n");
console.log(`  This computer:  https://localhost:${port}/`);
for (const address of addresses) console.log(`  On the phone:   https://${address}:${port}/?check=camera`);
console.log(`
  On the phone, the browser warns that the certificate is not trusted:
  tap "Advanced" then "Proceed". Then tap "Start camera".
  The phone and this computer must be on the same Wi-Fi.
`);
