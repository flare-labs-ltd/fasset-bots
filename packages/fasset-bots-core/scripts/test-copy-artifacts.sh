#!/bin/bash

set -e

projdir=$(pwd)
fassetsdir=$(readlink -f ../../../fasset)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

# build
echo "***** Building fasset... ****************************************"
cd ${fassetsdir}
yarn hardhat compile --config hardhatSetup.config.ts

echo "***** Copying artifacts... **************************************"
# copy fasset artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' -not -path './flattened/*' | xargs cp -u -t ${projdir}/artifacts --parents

# copy some fixed mocks
cd ${projdir}
cd scripts && cp -r test-mocks/ ../artifacts && cd ..
