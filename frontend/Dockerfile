# SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>
#
# SPDX-License-Identifier: AGPL-3.0-or-later

FROM node:current-alpine3.16

# Read the environment variable from the docker-compose file
ARG VITE_APP_API_URL
ARG VITE_MATOMO_URL
ARG VITE_MATOMO_SITE
ARG VITE_STRIPE_PURCHASE_PEER_URL

# Store the environment variables in the env.sh file to use later during runtime
RUN echo "export VITE_APP_API_URL=${VITE_APP_API_URL}" > /env.sh
RUN echo "export VITE_MATOMO_URL=${VITE_MATOMO_URL}" >> /env.sh
RUN echo "export VITE_MATOMO_SITE=${VITE_MATOMO_SITE}" >> /env.sh
RUN echo "export VITE_STRIPE_PURCHASE_PEER_URL=${VITE_STRIPE_PURCHASE_PEER_URL}" >> /env.sh

# Set the environment variables to the values placeholders, which will be replaced by the values from the environment variables or env.sh file at runtime
ENV VITE_APP_API_URL=__VITE_APP_API_URL__
ENV VITE_MATOMO_URL=__VITE_MATOMO_URL__
ENV VITE_MATOMO_SITE=__VITE_MATOMO_SITE__
ENV VITE_STRIPE_PURCHASE_PEER_URL=__VITE_STRIPE_PURCHASE_PEER_URL__

WORKDIR /app

COPY package*.json ./
RUN npm ci --fetch-retries 5 --fetch-retry-mintimeout 20000 --fetch-retry-maxtimeout 120000

COPY ./ /app
COPY .eslintrc*.js /

RUN npm run build

# FROM nginx
FROM openresty/openresty
RUN mkdir /app
COPY --from=0 /app/entry.sh /entry.sh
COPY --from=0 /app/dist /opt/dist
COPY --from=0 /env.sh /env.sh
COPY ./nginx_binaries/http.lua /usr/local/openresty/lualib/resty/http.lua
COPY ./nginx_binaries/http_connect.lua /usr/local/openresty/lualib/resty/http_connect.lua
COPY ./nginx_binaries/http_headers.lua /usr/local/openresty/lualib/resty/http_headers.lua
COPY ./nginx_binaries/resolver.lua /usr/local/openresty/lualib/resty/resolver.lua
COPY ./nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

EXPOSE 80

CMD [ "sh", "./entry.sh" ]
