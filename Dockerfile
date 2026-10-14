# Stage 1 — install production dependencies.
# better-sqlite3 is gone (we use node:sqlite), so there is no native build step
# and no need for a toolchain in the image.
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Stage 2 — the runtime image. Kept small: no compilers, no dev dependencies.
FROM node:24-alpine

# Run as the unprivileged node user that the base image already provides.
ENV NODE_ENV=production

WORKDIR /app

# Dependencies first, so a source-only change doesn't bust the cache.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# The database lives on a mounted volume, not in the image. DATA_DIR is read by
# src/data/store.js and points at the mount; the mount itself is what makes
# hangar entries survive a redeploy.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

VOLUME ["/data"]

USER node

# No EXPOSE and no HTTP server: a Discord gateway bot takes no inbound
# connections, and a health port would only invite the platform to probe one.
CMD ["node", "src/bot.js"]
