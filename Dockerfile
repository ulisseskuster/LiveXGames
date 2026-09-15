# LiveX Games - Dockerfile de Produção Otimizado
FROM node:22-alpine

WORKDIR /app

# Copia dependências do backend e instala
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Copia todo o código fonte e assets
WORKDIR /app
COPY database ./database
COPY frontend ./frontend
COPY backend ./backend

# Executa como usuário não-root (o backend não escreve em disco, apenas
# atende requisições HTTP e fala com PostgreSQL/serviços externos)
RUN chown -R node:node /app
USER node

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck interno
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
