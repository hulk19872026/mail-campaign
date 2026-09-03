# ---------- Stage 1: build the browser app ----------
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: build the server ----------
FROM node:22-alpine AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package*.json ./backend/
RUN npm --prefix backend ci --omit=dev && npm cache clean --force

COPY --from=backend /app/backend/dist ./backend/dist
COPY --from=backend /app/backend/migrations ./backend/migrations
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Flyer/logo uploads. Mount a Railway volume here to keep them across deploys.
RUN mkdir -p /data/uploads
ENV UPLOAD_DIR=/data/uploads
ENV PORT=8080
EXPOSE 8080

CMD ["node", "backend/dist/index.js"]
