# --- etapa 1: aplicación web (React)
FROM node:22-slim AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY shared ./shared
COPY scripts ./scripts
COPY frontend ./frontend
# Los pictogramas ARASAAC que no estén ya en el repositorio se descargan aquí.
RUN node scripts/fetch-pictograms.mjs && cd frontend && npm run build

# --- etapa 2: API (FastAPI), que además sirve la aplicación web
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PRODUCTION=1
WORKDIR /app
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY shared ./shared
COPY --from=web /app/frontend/dist ./frontend/dist
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
