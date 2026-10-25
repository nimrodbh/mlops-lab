FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npx vite build

FROM nginx:1.27-alpine
ENV GATEWAY_URL=http://gateway:3001
# nginx's entrypoint fills ${GATEWAY_URL} into this template at container start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
