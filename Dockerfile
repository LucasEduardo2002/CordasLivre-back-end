FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npx prisma generate

COPY . .
RUN npm run build

FROM base AS production

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]