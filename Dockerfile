FROM node:18

RUN mkdir -p /app &&  mkdir -p /data && mkdir -p /certs

ENV PORT=8080
ENV DB_PATH=/data/db.sqlite3
ENV SSL_CERT=/certs/fullchain.pem
ENV SSL_KEY=/certs/privkey.pem
ENV USE_STRICT_SUBSCRIPTIONS=1

WORKDIR /app
ADD . /app
RUN npm i --production

ENTRYPOINT ["npm", "start"]