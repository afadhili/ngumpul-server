FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && exec node dist/server.js"]
