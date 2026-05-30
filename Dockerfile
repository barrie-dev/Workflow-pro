# WorkFlow Pro – production container
# Build:  docker build -t workflowpro .
# Run:    docker run -p 4280:4280 --env-file .env.production workflowpro

FROM node:20-alpine

# Minimale OS-packages voor crypto-native modules
RUN apk add --no-cache dumb-init

WORKDIR /app

# Dependencies eerst (betere layer-cache)
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

# App-code
COPY src/ ./src/
COPY public/ ./public/

# Non-root user voor security
RUN addgroup -S wfp && adduser -S wfp -G wfp && chown -R wfp:wfp /app
USER wfp

ENV NODE_ENV=production
EXPOSE 4280

# dumb-init: correcte SIGTERM-afhandeling in containers
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
