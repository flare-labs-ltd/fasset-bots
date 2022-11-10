#!/bin/bash

echo "Checking yarn version..."

ACTUAL_VER=$(yarn -v)
REQUIRED_VER=$(sed -nE 's/\s*"packageManager"\s*:\s*"yarn@(.*)".*/\1/p' package.json)

if [ "${ACTUAL_VER}" != "${REQUIRED_VER}" ]; then
    echo "Required yarn version ${REQUIRED_VER}, but version ${ACTUAL_VER} is installed"
    echo "Please remove yarn with 'npm remove -g yarn' and then enable corepack yarn with 'corepack enable'"
    exit 1
fi
