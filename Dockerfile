# Build the official Telegram server at a fixed revision (including TDLib).
FROM node:22-bookworm-slim AS telegram-build
ARG TELEGRAM_BOT_API_REV=e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git cmake g++ make gperf libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init telegram-bot-api && cd telegram-bot-api \
    && git remote add origin https://github.com/tdlib/telegram-bot-api.git \
    && git fetch --depth=1 origin "$TELEGRAM_BOT_API_REV" \
    && git checkout --detach FETCH_HEAD \
    && git submodule update --init --recursive --depth=1
# Compile one source file at a time to keep build memory usage bounded.
RUN cmake -S telegram-bot-api -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/telegram \
    && cmake --build build --target install --parallel 1

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 zlib1g tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=telegram-build /opt/telegram/bin/telegram-bot-api /usr/local/bin/telegram-bot-api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/data
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start-container.js"]
