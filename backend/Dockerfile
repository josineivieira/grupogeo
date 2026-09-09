FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --ignore-scripts
COPY backend backend
RUN npm run db:generate -w backend && npm run build -w backend
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
WORKDIR /app/backend
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && node dist/main.js"]
