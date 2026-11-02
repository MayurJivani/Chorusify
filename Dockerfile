FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
# Coolify injects NODE_ENV=production at build time, which skips devDependencies and breaks
# the prepare/husky hook. Force development here; runtime stage sets production below.
ENV HUSKY=0
ENV NODE_ENV=development
RUN npm ci

COPY tsconfig.base.json eslint.config.js .prettierrc.json ./
COPY apps/web/ apps/web/
COPY apps/server/ apps/server/

ENV VITE_API_URL=/api
RUN npm run build:full

RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache tini

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/apps/web/package.json apps/web/package.json
COPY --from=builder /app/apps/server/package.json apps/server/package.json
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/public ./apps/server/public

RUN mkdir -p /app/apps/server/data

ENV NODE_ENV=production
ENV PORT=8888

EXPOSE 8888

WORKDIR /app/apps/server

ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
