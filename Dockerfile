FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
RUN apk add --no-cache ffmpeg tini su-exec
WORKDIR /app
# Declared after the apk layer so a new commit doesn't invalidate it
ARG GIT_SHA=dev
ENV NODE_ENV=production \
    PORT=4242 \
    DATA_DIR=/data \
    LUMEN_COMMIT=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4242
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1
# Starts as root only to fix /data ownership, then drops to the "node" user
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
