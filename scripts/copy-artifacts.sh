#!/bin/bash

projdir=$(pwd)
fassetsdir=$(readlink -f ../fasset)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

# build

rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle
rm -rf fasset-deployment; mkdir -p fasset-deployment
rm -rf fasset-config; mkdir -p fasset-config

# build
cd ${fassetsdir}
yarn clean
yarn compile

# copy artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' -not -path './flattened/*' | xargs cp -t ${projdir}/artifacts --parents

# fix some paths so that sourceName always matches the actual dir
cd ${projdir}
mkdir -p artifacts/flattened
mv artifacts/flare-sc artifacts/flattened/FlareSmartContracts.sol

# # generate typechain
yarn typechain --target=truffle-v5 --out-dir typechain-truffle "artifacts/**/+([a-zA-Z0-9_]).json"

# copy contract addresses
cd ${fassetsdir}/deployment/deploys
cp -R . ${projdir}/fasset-deployment

# copy deploy configs
cd ${fassetsdir}/deployment/config
cp -R . ${projdir}/fasset-config
