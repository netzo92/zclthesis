FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node server.mjs live-data.mjs ./
COPY --chown=node:node public ./public
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
