#!/bin/bash

set -e

projdir=$(pwd)
fassetsdir=$(readlink -f ../fasset)
liquidatordir=$(readlink -f ../FAsset-Liquidator)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi
if ! [ -d ${liquidatordir} ]; then echo "Missing dir ${liquidatordir}"; exit 1; fi

# build

rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle
rm -rf fasset-deployment; mkdir -p fasset-deployment
rm -rf fasset-config; mkdir -p fasset-config

# build
echo "***** Building fasset... ****************************************"
cd ${fassetsdir}
yarn clean
yarn compile

echo "***** Building liquidator... ****************************************"
cd ${liquidatordir}
yarn clean
yarn compile

echo "***** Copying artifacts... **************************************"
# copy fasset artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' -not -path './flattened/*' | xargs cp -t ${projdir}/artifacts --parents

# copy liquidator artifacts
cd ${liquidatordir}/artifacts
mkdir -p ${projdir}/artifacts/liquidator
find -name '*.json' -not -name '*.dbg.json' -path './contracts/*' -not -path './contracts/mock/*' | xargs cp -t ${projdir}/artifacts/liquidator --parents

# fix some paths so that sourceName always matches the actual dir
cd ${projdir}
mkdir -p artifacts/flattened
mv artifacts/flare-sc artifacts/flattened/FlareSmartContracts.sol

# fix source paths in liquidator jsons
find -name '*.json' -path './artifacts/liquidator/*' | xargs sed -i -e 's/"sourceName": "contracts\//"sourceName": "liquidator\/contracts\//'

# # generate typechain
echo "***** Building typechain... *************************************"
yarn typechain --target=truffle-v5 --out-dir typechain-truffle "artifacts/**/+([a-zA-Z0-9_]).json"

# copy contract addresses
echo "***** Copying config... *****************************************"
cd ${fassetsdir}/deployment/deploys
cp -R . ${projdir}/fasset-deployment
rm -f ${projdir}/fasset-deployment/hardhat.*

# copy deploy configs
cd ${fassetsdir}/deployment/config
cp -R . ${projdir}/fasset-config
