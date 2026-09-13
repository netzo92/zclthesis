FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server.mjs analytics-relay.mjs live-data.mjs market-comparison.mjs market-performance.mjs network-data.mjs transactions-data.mjs richlist-data.mjs richlist-feeds.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
