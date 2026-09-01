# syntax=docker/dockerfile:1
#
# Travel Timeline — single-container deploy.
# The Express server hosts both the API and the built client.
#
# Chromium is NOT installed: 1080p server-side export OOMs a 512 MB Render
# free instance. Reels record in the browser instead. Apple Photos is
# macOS-only and reports itself unavailable on Linux.

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
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_OPTIONS=--max-old-space-size=256
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
