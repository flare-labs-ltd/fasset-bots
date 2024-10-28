#FROM node:18 as nodemodules
FROM node:18 as build

WORKDIR /usr/src/app

RUN chown node /usr/src/app

#RUN apt-get update
#RUN apt-get install -y iputils-ping less nano

RUN chown node .

USER node

COPY --chown=node . .
#COPY --chown=node ./package.json .
#COPY --chown=node ./yarn.lock .

#RUN yarn install --network-timeout 100000
RUN yarn install

#################################

FROM node:18 as runtime
WORKDIR /usr/src/app

COPY --from=build --chown=node /usr/src/app /usr/src/app

#COPY --chown=node . .

#RUN ls -la

RUN yarn build
