FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S -G app app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js worker.js ./
COPY --chown=app:app public ./public
COPY --chown=app:app src ./src
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app docker/start.sh ./docker/start.sh
RUN mkdir -p /app/data && chown -R app:app /app
ENV DATA_DIR=/app/data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ready || exit 1
CMD ["./docker/start.sh"]
