/**
 * The port a Vite dev server is really listening on (findings register CR41). When 5173 is busy,
 * Vite moves to 5174 but `config.server.port` still says 5173, so the printed phone links were wrong.
 *
 * @param {{ httpServer?: { address(): unknown } | null, config: { server: { port?: number } } }} server
 * @returns {number}
 */
export function listeningPort(server) {
  const address = server.httpServer?.address();
  if (address && typeof address === "object" && "port" in address && typeof address.port === "number") return address.port;
  return server.config.server.port ?? 5173;
}
