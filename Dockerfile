FROM node:18

WORKDIR /usr/src/app
RUN chown node /usr/src/app

RUN apt-get update && apt-get install -y iputils-ping less nano build-essential

RUN chown node .

USER node

RUN mkdir -p log

COPY --chown=node . .

RUN yarn install


RUN yarn

RUN yarn build
