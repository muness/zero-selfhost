FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@10.12.1
WORKDIR /opt/zero
COPY . .
ENV CI=1 CLOUDFLARE_ENV=local WRANGLER_SEND_METRICS=false
RUN pnpm install --frozen-lockfile
RUN VITE_SELF_HOSTED=true VITE_PUBLIC_APP_URL=https://zero.invalid \
    VITE_PUBLIC_BACKEND_URL=https://zero.invalid pnpm --filter @zero/mail build
RUN mkdir /state && chown -R node:node /opt/zero /state
USER node
CMD ["python3", "/opt/zero/docker/self-host/start.py"]
