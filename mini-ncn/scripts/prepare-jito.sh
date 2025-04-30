#!/usr/bin/env sh

# This step is only needed for localnet testing

JITO_ADMIN=../keys/jito-admin.json
RPC_URL="http://127.0.0.1:8899"
JITO_ADMIN_ADDRESS=$(solana address -k $JITO_ADMIN)

solana -u l airdrop 10 $JITO_ADMIN

jito-restaking-cli --rpc-url $RPC_URL --keypair $JITO_ADMIN restaking config initialize
jito-restaking-cli --rpc-url $RPC_URL --keypair $JITO_ADMIN vault config initialize 10 $JITO_ADMIN_ADDRESS

