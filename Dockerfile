<<<<<<< HEAD
FROM node:20-alpine AS base

# ---- dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

# ---- runtime ----
FROM base AS runtime
WORKDIR /app

# Copy installed production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy the entire repository (static site + server + netlify functions/lib/compat)
COPY . .

# Remove development-only tooling that shouldn't be in the image
RUN rm -rf .github drizzle-kit* *.config.ts

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]

=======
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
>>>>>>> refs/remotes/origin/pr-65
