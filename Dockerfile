FROM node:latest

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r steam && useradd -r -g steam steam && \
    mkdir -p /app/logs && \
    chown -R steam:steam /app && \
    chmod 755 /app && \
    chmod 777 /app/logs

COPY --chown=steam:steam package*.json ./
RUN npm ci --only=production

COPY --chown=steam:steam . .

USER steam
EXPOSE 3000
CMD ["npm", "start"]
