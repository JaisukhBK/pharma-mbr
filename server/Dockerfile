FROM node:20-alpine
LABEL compliance="21 CFR Part 11, GAMP5 Cat.5, ISA-88"
WORKDIR /app
RUN addgroup -g 1001 -S pmbr && adduser -S pmbr -u 1001 -G pmbr
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN chown -R pmbr:pmbr /app
USER pmbr
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:3002/health || exit 1
EXPOSE 3002
CMD ["node", "index.js"]
