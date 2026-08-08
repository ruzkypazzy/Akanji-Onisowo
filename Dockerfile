FROM node:20-slim

# Install onchainos CLI (required for trading)
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./
COPY tsconfig.json ./
COPY vitest.config.ts ./

RUN npm install --production=false

# Copy source
COPY src/ ./src/
COPY tests/ ./tests/

# Build TypeScript
RUN npx tsc

# Create data + logs directories
RUN mkdir -p /app/data /app/logs

# Volume for journal DB and logs
VOLUME ["/app/data", "/app/logs"]

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD test -f /app/data/journal.db || exit 1

CMD ["node", "dist/main.js"]
