FROM node:20-alpine
WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3005
# One JSON object per log line, for the log pipeline
ENV LOG_FORMAT=json

COPY package*.json ./
RUN npm ci --omit=dev

# dist/ is the compiled service; config/ (outdated.json) and migrations/ are read at runtime
COPY dist/ .
COPY config/ ./config/
COPY migrations/ ./migrations/

USER node
EXPOSE 3005

# busybox wget ships with alpine; /health needs no identity header
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# Run `node migrate.js` once per deploy (job or init container), or set MIGRATE_ON_START=true
CMD [ "node", "server.js" ]
