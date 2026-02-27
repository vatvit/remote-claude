FROM node:22-alpine

WORKDIR /app/host

COPY host/package.json host/package-lock.json* ./
RUN npm install

EXPOSE 8888
EXPOSE 8887

CMD ["npm", "start"]
