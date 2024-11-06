FROM node:18

WORKDIR /usr/src/app
RUN git config --global --add safe.directory /home/fasset-bots/fasset-bots

RUN apt-get update && apt-get install -y default-mysql-client iputils-ping less nano

COPY package.json yarn.lock ./

COPY .yarn/ .yarn/
COPY .yarnrc.yml ./
COPY ./packages ./packages

RUN yarn install --immutable

COPY .env.template.docker ./.env.template
COPY secrets.template.json ./
COPY config.json ./
COPY tsconfig.json ./