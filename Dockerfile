FROM node:22-bookworm-slim

ARG XRAY_VERSION=26.9.30
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip" -o /tmp/xray.zip \
    && unzip -q /tmp/xray.zip -d /tmp/xray \
    && install -m 0755 /tmp/xray/xray /usr/local/bin/xray \
    && rm -rf /tmp/xray /tmp/xray.zip

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY xray/README.md ./xray/README.md

ENV NODE_ENV=production
ENV XRAY_PORT=10000
ENV WS_PATH=/api/ws

CMD ["npm", "start"]
