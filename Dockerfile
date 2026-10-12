# The app's image (docs/design-docs/hosting-and-deploy.md). The build and the production dependencies are made on the
# build platform, since neither depends on the CPU: the dependencies are plain JavaScript and node:sqlite is built in.
# Dependabot keeps the digest current in both FROM lines, which name the image directly so it can find them.

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS pnpm
# The pnpm version pinned in package.json's packageManager field.
RUN npm install --global --ignore-scripts pnpm@12.10.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM pnpm AS deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM pnpm AS build
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src src
RUN pnpm build

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a
# The app needs no package manager, and the ones in the base image carry their own vulnerabilities.
RUN apk add --no-cache tini \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
# HOST is for the container's network: only Caddy, on the shared network, reaches the port.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BEANQUERY_DB=/data/beanquery.db
# The database volume's mount point, and the backups folder's, owned by node, so new volumes start out writable.
RUN mkdir -p /data /backups && chown node:node /data /backups
COPY package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/dist dist
# The fonts are read from the package root's src/web/assets/fonts/, since tsc copies no binary files into dist/.
COPY src/web/assets/fonts src/web/assets/fonts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/web/server.js"]
