#!/bin/bash

projdir=$(pwd)
fassetsdir=$(readlink -f ../fasset)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

# build

rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle
rm -rf fasset-deployment; mkdir -p fasset-deployment

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

# fix some paths so that sourceName always matches the actual dir
cd ${projdir}
mkdir -p artifacts/flattened
mv artifacts/flare-sc artifacts/flattened/FlareSmartContracts.sol


# copy contract addresses

cd ${fassetsdir}/deployment/deploys
cp -R . ${projdir}/fasset-deployment