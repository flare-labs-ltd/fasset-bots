#!/bin/bash

set -e

projdir=$(pwd)
fassetsdir=$(readlink -f ../../../fasset)
liquidatordir=$(readlink -f ../fasset-liquidator)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi
if ! [ -d ${liquidatordir} ]; then echo "Missing dir ${liquidatordir}"; exit 1; fi

# build
echo "***** Building fasset... ****************************************"
cd ${fassetsdir}
yarn
yarn clean
yarn hardhat compile && yarn typechain-prepare && yarn typechain-truffle-v5

echo "***** Building liquidator... ****************************************"
cd ${liquidatordir}
yarn
yarn clean
yarn compile

echo "***** Copying artifacts... **************************************"
# clean
cd ${projdir}
rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle

# copy fasset artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' -not -path './flattened/*' | xargs cp -t ${projdir}/artifacts --parents
cd ${fassetsdir}
yarn typechain-after

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

# copy some fixed mocks
cd scripts && cp -r test-mocks/ ../artifacts && cd ..

# # generate typechain
echo "***** Building typechain... *************************************"
yarn typechain --target=truffle-v5 --out-dir typechain-truffle "artifacts/**/+([a-zA-Z0-9_]).json"
bash scripts/rename-and-update-artifacts.sh

# copy contract addresses
echo "***** Copying config... *****************************************"
# copy schemas and deploy configs for hardhat (for unit tests)
cd ${fassetsdir}/deployment/config
cp ./*.schema.json ${projdir}/fasset-config/
cp -R hardhat ${projdir}/fasset-config/
