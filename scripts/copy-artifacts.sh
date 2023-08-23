#!/bin/bash

projdir=$(pwd)
fassetsdir=$(readlink -f ../fasset)

if ! [ -d ${fassetsdir} ]; then echo "Missing dir ${fassetsdir}"; exit 1; fi

# build

rm -rf artifacts; mkdir -p artifacts
rm -rf typechain-truffle; mkdir -p typechain-truffle

# build
cd ${fassetsdir}
yarn c

# copy artifacts
cd ${fassetsdir}/artifacts
find -name '*.json' -not -name '*.dbg.json' -not -path './build-info/*' -not -path './cache/*' | xargs cp -t ${projdir}/artifacts --parents

# copy typechain
cd ${fassetsdir}
cp -R typechain-truffle ${projdir}
cp ${projdir}/scripts/types.d.ts ${projdir}/typechain-truffle

cd ${projdir}

rm -rf artifacts/flare-sc/AddressUpdater.json
rm -rf artifacts/flare-sc/WNat.json
rm -rf artifacts/flare-sc/GovernanceSettings.json
rm -rf artifacts/flare-sc/VPContract.json
rm -rf artifacts/flare-smart-contracts/contracts/userInterfaces/IFtso.sol
rm -rf artifacts/flare-smart-contracts/contracts/ftso/interface/IIFtso.sol
rm -rf artifacts/flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol
rm -rf artifacts/flare-smart-contracts/contracts/userInterfaces/IFtsoManager.sol
rm -rf artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol