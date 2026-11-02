FROM node:20-alpine
WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3005

COPY package*.json ./
RUN npm ci --omit=dev

# dist/ is the compiled service; config/ (outdated.json) and migrations/ are read at runtime
COPY dist/ .
COPY config/ ./config/
COPY migrations/ ./migrations/

USER node
EXPOSE 3005

# Run `node migrate.js` once per deploy (job or init container), or set MIGRATE_ON_START=true
CMD [ "node", "server.js" ]
