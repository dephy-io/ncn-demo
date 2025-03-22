#!/usr/bin/env sh

solana-test-validator \
    --slots-per-epoch 32 \
    --bpf-program RestkWeAVL8fRGgzhfeoqFhsqKRchg6aa1XrcH96z4Q ./fixtures/jito_restaking_program.so \
    --bpf-program Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8 ./fixtures/jito_vault_program.so \
    --bpf-program FMtP7JSgYneYu36nisXubFWTWw6LGC9EFJ6YhjAq6CQr ./mini-ncn/target/deploy/mini_ncn.so \
    $@
