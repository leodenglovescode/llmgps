FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV LLMGPS_CONTAINERIZED=true
ENV LLMGPS_DATA_FILE=/data/llmgps-data.sqlite

RUN mkdir -p /data && chown -R node:node /app /data

COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

USER node

VOLUME ["/data"]

EXPOSE 3000

CMD ["npm", "run", "start"]