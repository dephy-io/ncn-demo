#!/usr/bin/env sh

NETWORK=$1
AUTHORITY=$2
NAME=$3
SYMBOL=$4
DECIMALS=$5

if [ -z "$NETWORK" ] || [ -z "$AUTHORITY" ] || [ -z "$NAME" ] || [ -z "$SYMBOL" ] || [ -z "$DECIMALS" ]; then
  echo "Usage: $0 <network> <authority> <name> <symbol> <decimals>"
  exit 1
fi

# --program-2022 --enable-metadata
TOKEN_MINT=$(spl-token -u $NETWORK create-token --mint-authority $AUTHORITY --decimals $DECIMALS --output json | jq -r '.commandOutput.address')

# spl-token initialize-metadata -u $NETWORK --mint-authority $AUTHORITY --update-authority $AUTHORITY $TOKEN_MINT $NAME $SYMBOL ""

spl-token display -u $NETWORK $TOKEN_MINT

spl-token create-account -u $NETWORK $TOKEN_MINT --owner $AUTHORITY
spl-token mint -u $NETWORK --mint-authority $AUTHORITY --recipient-owner $AUTHORITY $TOKEN_MINT 1000000000000
