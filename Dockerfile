# 构建阶段不需要 .env——密钥运行时注入（compose env_file），不烧进镜像
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV KB_PORT=3001
EXPOSE 3001
CMD ["node", "src/index.ts"]
