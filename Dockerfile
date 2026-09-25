# syntax=docker/dockerfile:1
#
# Production image for the Nura API. Built by CodeBuild (buildspec.yml) and
# run on the EC2 host by deploy/docker-compose.yml. Locally:
#   docker build -t nura-api .
#   docker run --env-file .env -p 5000:5000 nura-api

# ---- dependencies (production only) ----------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# NODE_ENV=production makes the "prepare" script skip husky (a dev tool).
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=5000
WORKDIR /app

# tini: forwards SIGTERM to node so index.js's graceful shutdown (close
# WebSockets, stop schedulers, disconnect Mongo) runs on `docker stop`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
# In production the logger also writes to ./logs (utils/logger.js).
RUN mkdir -p logs && chown node:node logs

USER node
EXPOSE 5000

# Liveness only (/health never touches the DB); the deploy's ValidateService
# step checks /health/ready, which also requires MongoDB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
