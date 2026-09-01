# syntax=docker/dockerfile:1
#
# Travel Timeline — single-container deploy.
# The Express server hosts both the API and the built client; Chromium is
# installed for the server-side video exporter (FFmpeg ships via ffmpeg-static).
#
# Note: the Apple Photos story builder is macOS-only and reports itself as
# unavailable on Linux — the manual trip builder, globe, and social features
# all work normally.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
# Build-time client env (Supabase social is optional; omit to disable).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    RENDER_FORCE_SOFTWARE=1
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
