FROM evoapicloud/evolution-api:v2.3.7@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339
COPY patch-interactive.cjs /tmp/orderiq-patch-interactive.cjs
COPY check-interactive.cjs /tmp/orderiq-check-interactive.cjs
RUN node /tmp/orderiq-patch-interactive.cjs /evolution/dist/main.js \
    && node --check /evolution/dist/main.js \
    && node /tmp/orderiq-check-interactive.cjs /evolution/dist/main.js \
    && rm /tmp/orderiq-patch-interactive.cjs /tmp/orderiq-check-interactive.cjs
