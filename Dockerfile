# Estágio de Build
FROM node:20-alpine AS build

WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./
COPY prisma ./prisma/

# Instala as dependências e gera o Prisma Client
RUN npm install
RUN npx prisma generate

# Copia o restante do código e compila
COPY . .
RUN npm run build

# Estágio de Produção (Imagem final mais leve)
FROM node:20-alpine

WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Expõe a porta que o NestJS usa
EXPOSE 3000

# Comando para rodar as migrations e iniciar a aplicação
CMD npx prisma migrate deploy && node dist/main