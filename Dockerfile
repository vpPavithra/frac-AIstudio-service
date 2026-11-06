# Runtime image for frac-studio-service, built by build.sh in the Jenkins "Build" stage.
# Expects dist/, config/ and migrations/ already in the build context (unzipped from Dockerfile.build's
# dist.zip). Runs the compiled server on port 3005 as the non-root node user.
FROM node:20-alpine
WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3005
# One JSON object per log line, for the log pipeline
ENV LOG_FORMAT=json

COPY package*.json ./
RUN npm ci --omit=dev

# dist/ is the compiled service (dist/mocks holds the sample-data provider used when no API key is
# set). config/ (service.json, outdated.json, review-rules.json, frac-sizes.json) and migrations/
# are read at runtime
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
