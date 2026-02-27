FROM node:22-alpine

WORKDIR /app/host

COPY host/package.json host/package-lock.json* ./
RUN npm install

COPY host/ ./
COPY web/ /app/web/

EXPOSE 8888

CMD ["npm", "start"]
