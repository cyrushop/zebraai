FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
USER node
CMD ["node", "server.js"]
