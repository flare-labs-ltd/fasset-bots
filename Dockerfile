FROM node:18 as update

WORKDIR /usr/src/app
RUN chown node /usr/src/app

RUN apt-get update
RUN apt-get install -y iputils-ping less nano

FROM node:18 as nodemodules

RUN chown node .

USER node

COPY --chown=node ./package.json .
COPY --chown=node ./yarn.lock .

RUN yarn install

FROM node:18 as runtime1

COPY --chown=node . .

RUN yarn

FROM node:18 as runtime2

RUN yarn build
