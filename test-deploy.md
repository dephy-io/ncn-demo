# Testing Deployment of mini-ncn

## Simulated Environment

### 1. Start Local Solana Network

```bash
solana-test-validator -r --bpf-program RestkWeAVL8fRGgzhfeoqFhsqKRchg6aa1XrcH96z4Q fixtures/jito_restaking_program.so --bpf-program Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8 fixtures/jito_vault_program.so
```

### 2. Anchor Project Build and Deployment

1. **Build the Anchor Project**
    ```bash
    anchor build
    ```

2. **Deploy the Anchor Program**
    ```bash
    anchor deploy -p mini_ncn --provider.cluster localnet

    # or with solana-cli
    solana program -u l deploy target/deploy/mini_ncn.so
    ```

### 3. Contract Initialization and Account Preparation

1. **Request Airdrop**
    ```bash
    solana -u l airdrop 10 keys/jito-admin.json
    ```

2. **Initialize Config and Vault**
    ```bash
    jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair keys/jito-admin.json restaking config initialize
    jito-restaking-cli --rpc-url http://127.0.0.1:8899 --keypair keys/jito-admin.json vault config initialize 10
    ```


### 4. Initialize Mini NCN

1. **Initialize NCN**
    ```bash
    bun run scripts/cli.ts initialize-ncn -r http://127.0.0.1:8899 -k <ncn-authority> --rewards-mint <mint>
    ```

2. **Initialize Ballot Box**
    ```bash
    bun run scripts/cli.ts initialize-ballot-box -r http://127.0.0.1:8899 -k <ncn-authority> --config <config-pubkey>
    ```

3. **Initialize Vault**
    ```bash
    # transfer <amount> <mint> to vaultAdmin
    spl-token transfer <mint> <amount> <vaultAdmin>

    bun run scripts/cli.ts initialize-vault -r http://127.0.0.1:8899 -k <ncn-authority> --config <config-pubkey> --st-mint <mint> --amount <amount>
    ```

4. **Initialize Operators**
    ```bash
    jito-restaking-cli --keypair <operator-authority> restaking operator initialize <operator_fee_bps>

    bun run scripts/cli.ts initialize-operator -r http://127.0.0.1:8899 -k <operator-authority> --config <config-pubkey> --operator <operator-pubkey>
    ```
