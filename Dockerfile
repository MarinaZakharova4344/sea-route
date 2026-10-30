# Образ для размещения на Hugging Face Spaces (Docker) и любом хостинге с контейнерами.
# База заполняется демонстрационными данными при каждом запуске (src/db/ensure-demo.ts).
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && mkdir -p data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=7860 \
    DEMO_RESEED=always \
    DEMO_SET=large \
    APP_TIMEZONE=Europe/Moscow

EXPOSE 7860
USER node

CMD ["npm", "run", "start:render"]
