#!/usr/bin/env sh


ADMIN_KEYPAIR="./keys/jito-admin.json"
OP0_KEYPAIR="./keys/op0-admin.json"
OP1_KEYPAIR="./keys/op1-admin.json"
USER_KEYPAIR="./keys/user.json"

# prepare keypair
solana-keygen new --no-bip39-passphrase -s -o $ADMIN_KEYPAIR
solana-keygen new --no-bip39-passphrase -s -o $OP0_KEYPAIR
solana-keygen new --no-bip39-passphrase -s -o $OP1_KEYPAIR
solana-keygen new --no-bip39-passphrase -s -o $USER_KEYPAIR

# airdrop
solana airdrop -u l -k $ADMIN_KEYPAIR 10
solana airdrop -u l -k $OP0_KEYPAIR 10
solana airdrop -u l -k $OP1_KEYPAIR 10
solana airdrop -u l -k $USER_KEYPAIR 10

# alias for simpler cli
alias jito-admin="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair $ADMIN_KEYPAIR"
alias jito-op0="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair $OP0_KEYPAIR"
alias jito-op1="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair $OP1_KEYPAIR"
alias jito-user="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair $USER_KEYPAIR"

# 1. init config
jito-admin restaking config initialize

# 2. init NCN
NCN=$(jito-admin restaking ncn initialize 2>&1 | rg --pcre2 -o '(?<=initialized at address: ).*')
echo "NCN=$NCN"

# 3. init vault
# init vault config
jito-admin vault config initialize 10 $(solana address -k $ADMIN_KEYPAIR)
# create token
TOKEN_MINT=$(spl-token -u l create-token --mint-authority $ADMIN_KEYPAIR --output json | jq -r '.commandOutput.address')
echo "TOKEN_MINT: $TOKEN_MINT"
spl-token -u l create-account $TOKEN_MINT --owner $ADMIN_KEYPAIR
TOKEN_ACCOUNT=$(spl-token -u l address --token $TOKEN_MINT --owner $ADMIN_KEYPAIR --verbose --output json | jq -r '.associatedTokenAddress')
spl-token -u l mint $TOKEN_MINT 10000 --mint-authority $ADMIN_KEYPAIR -- $TOKEN_ACCOUNT
# init vault
jito-admin vault vault initialize $TOKEN_MINT 5 10 100 9 1000000000


# 4. init operator
OPERATOR=$(jito-op0 restaking operator initialize 1000 2>&1 | rg --pcre2 -o '(?<=initialized at address: ).*')
echo "OPERATOR=$OPERATOR"

# 5. init NCN operator state and warmup
jito-admin restaking ncn initialize-ncn-operator-state $NCN $OPERATOR
sleep 3  # need to wait for next epoch
jito-admin restaking ncn ncn-warmup-operator $NCN $OPERATOR
jito-op0 restaking operator operator-warmup-ncn $OPERATOR $NCN


# mini-ncn
# We haven't add cli for those actions yet. See tests/mini-ncn.ts
