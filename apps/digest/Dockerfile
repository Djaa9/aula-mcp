# Daily Aula digest, run as a Railway cron service. Build context is the repo
# root: docker build -f apps/digest/Dockerfile .
#
# Same base as homeassistant-addon/Dockerfile and for the same reasons: pnpm
# install needs Node (node:sqlite), the MCP server code needs Bun at runtime.
FROM node:24-bookworm-slim

COPY --from=oven/bun:1.3-debian /usr/local/bin/bun /usr/local/bin/bun

RUN corepack enable \
  && corepack prepare pnpm@11.1.3 --activate

WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

ENV AULA_MCP_DIR=/data
ENV AULA_MCP_NO_KEYCHAIN=1

CMD ["bun", "apps/digest/src/run.ts"]
