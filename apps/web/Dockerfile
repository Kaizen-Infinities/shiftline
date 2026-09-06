# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS dev
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w @shiftline/shared
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "@shiftline/web", "--", "--host", "0.0.0.0"]

FROM dev AS build
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @shiftline/web

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
