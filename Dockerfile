FROM node:22.16.0-bookworm-slim

WORKDIR /usr/src/app

COPY package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080
CMD ["npm", "start"]
