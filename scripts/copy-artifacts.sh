#!/bin/bash

fassetsdir=../fasset
curdir=$(pwd)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

rm -rf artifacts
mkdir -p artifacts

cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -name '*Mock*' -not -path './build-info/*' | xargs cp -t ${curdir}/artifacts --parents
cd -
