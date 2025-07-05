# Etap budowania
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

# Etap uruchamiania
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app /app
RUN npm install --production

EXPOSE 3000

CMD ["npm", "run", "start"]
