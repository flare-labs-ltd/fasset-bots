FROM node:18

WORKDIR /usr/src/app
RUN chown node /usr/src/app

RUN apt-get update && apt-get install -y iputils-ping less nano

RUN chown node .

USER node

COPY --chown=node ./package.json .
COPY --chown=node ./yarn.lock .

RUN yarn install

COPY --chown=node . .

RUN yarn

RUN yarn build