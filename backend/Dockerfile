FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
COPY src ./src
COPY start.js ./start.js
RUN npx prisma generate
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "start.js"]
