# DuniaLab API image. Build from the repo root:
#   docker build -f docker/api.Dockerfile -t dunialab-api .
# Debian slim (not Alpine): TypeScript 7's native compiler ships glibc binaries.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build -w @dunialab/content -w @dunialab/mastery -w @dunialab/api \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/content/package.json ./packages/content/package.json
COPY --from=build /app/packages/content/dist ./packages/content/dist
COPY --from=build /app/packages/content/packs ./packages/content/packs
COPY --from=build /app/packages/mastery/package.json ./packages/mastery/package.json
COPY --from=build /app/packages/mastery/dist ./packages/mastery/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
