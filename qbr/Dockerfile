# syntax=docker/dockerfile:1

# ---- Build: extract data from data/QBR_Data_<date>.md, type-check, bundle ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Runtime: static files on unprivileged nginx (runs as non-root) ----
FROM nginxinc/nginx-unprivileged:1.30-alpine
# The listen port comes from $PORT (Cloud Run / Kubernetes style); default 8080.
# Templates in /etc/nginx/templates are rendered with envsubst at container start.
# Optional password: set BASIC_AUTH_USER and BASIC_AUTH_PASS.
ENV PORT=8080
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/40-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
