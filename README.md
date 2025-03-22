# NCN Demo

This example shows a minimal NCN usage.

- The program initializes the vault connected to a NCN.
- The admin can ask operators to vote a certain message.
- Operators then vote with their token delegations.
- Finally, the admin checks the consensus and distributes rewards.

## Prerequisites

- Solana CLI
- Jito Restaking CLI (https://github.com/jito-foundation/restaking/blob/master/cli/getting_started.md#setup)


## Run Demo

```sh
cd mini-ncn
anchor test
```


## Manual Setup

NOTE: User should just run `anchor test`. This section is just showing steps in `scripts/run_all.sh`.


### 0. Prepare env

    ```sh
    # start validator
    ./scripts/start-localnet.sh

    # prepare keypair
    solana-keygen new -o ./keys/jito-admin.json
    solana-keygen new -o ./keys/op0-admin.json
    solana-keygen new -o ./keys/op1-admin.json
    solana-keygen new -o ./keys/user.json
    solana airdrop -u l -k ./keys/jito-admin.json 10
    solana airdrop -u l -k ./keys/op0-admin.json 10
    solana airdrop -u l -k ./keys/op1-admin.json 10
    solana airdrop -u l -k ./keys/user.json 10

    # alias for simpler cli
    alias jito-admin="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair ./keys/jito-admin.json"
    alias jito-op0="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair ./keys/op0-admin.json"
    alias jito-op1="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair ./keys/op1-admin.json"
    alias jito-user="jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair ./keys/user.json"
    ```

### 1. init config

    ```sh
    jito-admin restaking config initialize
    ```

### 2. init NCN

    ```sh
    jito-admin restaking ncn initialize
    ```

### 3. init operator

    ```sh
    jito-op0 restaking operator initialize 1000
    ```

### 4. init NCN operator state and warmup

    ```sh
    jito-admin restaking ncn initialize-ncn-operator-state <NCN> <OPERATOR>
    jito-admin restaking ncn ncn-warmup-operator <NCN> <OPERATOR>
    jito-op0 restaking operator operator-warmup-ncn <OPERATOR> <NCN>
    ```

### 5. init token and vault

    ```sh
    spl-token create-token
    spl-token create-account <TOKEN_MINT> --owner <ADMIN>
    spl-token mint <TOKEN_MINT> 1000 -- <TOKEN_ACCOUNT>
    ```

    ```sh
    jito-admin vault vault initialize <TOKEN_MINT> 5 10 100 9 1000000000
    ```
