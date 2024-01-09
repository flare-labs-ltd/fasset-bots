#!/bin/bash

if [ ! -f dist/printlog.js ]; then
    yarn tsc src/utils/printlog.ts --esModuleInterop --outDir dist
fi

node dist/printlog.js "$@"
