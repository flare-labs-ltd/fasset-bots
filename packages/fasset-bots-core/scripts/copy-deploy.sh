#!/bin/bash

set -e

projdir=$(pwd)
fassetsdir=$(readlink -f ../../../fasset)

if [ -z "$1" ]; then echo -e "Usage: $0 <network>\n  where network is on of 'coston', 'songbird' etc."; exit 1; fi
if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

NETWORK="$1"

mkdir -p fasset-deployment
mkdir -p fasset-config

cp ${fassetsdir}/deployment/deploys/${NETWORK}.json fasset-deployment/

cd ${fassetsdir}/deployment/config
cp ./*.schema.json ${projdir}/fasset-config/
cp -R ${NETWORK} ${projdir}/fasset-config/
