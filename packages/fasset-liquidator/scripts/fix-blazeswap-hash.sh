file_path=node_modules/blazeswap/contracts/periphery/libraries/BlazeSwapLibrary.sol;
initial_hash=$(sed -nE 's/.*([0-9a-fA-F]{64}).*/\1/p' "$file_path") &&
correct_hash=$(echo $(yarn ts-node scripts/blazeswap-base-pair-hash.ts) | sed 's/.*\([0-9a-fA-F]\{64\}\).*/\1/') &&
sed -i "s/$initial_hash/$correct_hash/g" $file_path;