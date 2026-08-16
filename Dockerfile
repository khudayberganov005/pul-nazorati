FROM node:20-alpine

# better-sqlite3 kabi native modullarni kompilyatsiya qilish uchun kerak
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
