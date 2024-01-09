#!/bin/bash

for fname in typechain-truffle/*.d.ts; do
    sed -i -E -e 's/(\/\* eslint-disable \*\/)/\0\n\nimport type { Truffle } from ".\/types";/' -e 's/type AllEvents =/export \0/' $fname
    mv $fname "${fname//.d.ts/.ts}";
done
sed -i -E -e 's/^declare global \{$/export type * from ".\/types";/' -e 's/^(  )?\}$//' -e 's/^ *namespace Truffle \{//' -e 's/interface Artifacts/export \0/' typechain-truffle/index.ts
cp -f scripts/types.ts typechain-truffle/
