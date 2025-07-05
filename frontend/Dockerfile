FROM node:18
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build || echo "no build step"
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "3000"]
