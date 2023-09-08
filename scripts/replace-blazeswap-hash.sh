original_hash=bf4c1c435583a2bb8d763765a34a46e376071c3b3d80e5bbac0950aeecdf31cb;
correct_hash=$(echo $(yarn ts-node scripts/blazeswap-base-pair-hash.ts) | sed 's/.*\([0-9a-fA-F]\{64\}\).*/\1/') &&
sed -i "s/$original_hash/$correct_hash/g" node_modules/blazeswap/contracts/periphery/libraries/BlazeSwapLibrary.sol;