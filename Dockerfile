FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src src
COPY landing/public/ui.css landing/public/account.css landing/public/favicon.svg landing/public/
COPY db/migrations db/migrations
COPY knowledge knowledge
COPY scripts/build.mjs scripts/database.mjs scripts/
RUN node scripts/build.mjs

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ARG RAILWAY_GIT_COMMIT_SHA
RUN printf '%s' "$RAILWAY_GIT_COMMIT_SHA" | grep -Eqx '[0-9a-f]{40}'
RUN node -e "fetch('https://www.postgresql.org/media/keys/ACCC4CF8.asc').then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status)))).then(t => require('fs').writeFileSync('/usr/share/keyrings/pgdg.asc', t))" \
 && echo '0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76  /usr/share/keyrings/pgdg.asc' | sha256sum -c - \
 && echo 'deb [signed-by=/usr/share/keyrings/pgdg.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends tini=0.19.0-1+b3 libpq5=18.6-1.pgdg12+2 postgresql-client-18=18.6-1.pgdg12+2 \
 && rm -rf /var/lib/apt/lists/* \
 && /usr/lib/postgresql/18/bin/pg_dump --version \
 && /usr/lib/postgresql/18/bin/pg_restore --version
WORKDIR /opt/scoat/release
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /build/dist dist
COPY --from=build /build/db/migrations db/migrations
COPY --from=build /build/knowledge knowledge
COPY --from=build /build/scripts/database.mjs scripts/database.mjs
RUN node --input-type=module -e "const state = await (await import('/opt/scoat/release/dist/release.js')).verifyRelease(); if (state.kind !== 'verified') { console.error(state.reason); process.exit(1); } console.log(JSON.stringify({ release: state.release.digest, revision: process.env.RAILWAY_GIT_COMMIT_SHA }));"
LABEL org.opencontainers.image.source="https://github.com/quanvu309/scoat" org.opencontainers.image.revision="${RAILWAY_GIT_COMMIT_SHA}"
ENV SCOAT_SOURCE_REVISION=${RAILWAY_GIT_COMMIT_SHA} SCOAT_PG_BIN=/usr/lib/postgresql/18/bin
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/railway.js"]
