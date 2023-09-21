#!/bin/bash

projdir=$(pwd)
fassetsdir=$(readlink -f ../fasset)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

# build

rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle

# build
cd ${fassetsdir}
yarn clean
yarn compile

# copy artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' -not -path './flattened/*' | xargs cp -t ${projdir}/artifacts --parents

# copy typechain
cd ${fassetsdir}
cp -R typechain-truffle ${projdir}
cp ${projdir}/scripts/types.d.ts ${projdir}/typechain-truffle
