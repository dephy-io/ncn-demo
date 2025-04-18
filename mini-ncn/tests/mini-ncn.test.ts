import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token"
import { MerkleTree } from "./merkle-tree";
import { MiniNcn } from "../target/types/mini_ncn";
import { assert } from "chai";
import { $ } from "bun";
import { readFileSync } from "fs";
import { buildRewardsTree } from "./rewards-tree";

const JITO_RESTAKING_ID = new web3.PublicKey("RestkWeAVL8fRGgzhfeoqFhsqKRchg6aa1XrcH96z4Q");
const JITO_VAULT_ID = new web3.PublicKey("Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8");

const debugPubkeys = (pubkeys) => {
  for (const name in pubkeys) {
    console.log(name, pubkeys[name].toString());
  }
};

const loadKey = (path: string) => {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

const getInitializedAddress = (output: string) => {
  return new web3.PublicKey(output.match(/(?<=initialized at address: ).*/)[0])
}

const jitoAdminKeypair = loadKey('../keys/jito-admin.json');
const op0AdminKeypair = loadKey('../keys/op0-admin.json');
const op1AdminKeypair = loadKey('../keys/op1-admin.json');
const userKeypair = loadKey('../keys/user.json');
const authority = web3.Keypair.generate();

const jitoCli = ['jito-restaking-cli', '--rpc-url', 'http://127.0.0.1:8899']
const jitoCliAdmin = [...jitoCli, '--keypair', '../keys/jito-admin.json']
const jitoCliOp0 = [...jitoCli, '--keypair', '../keys/op0-admin.json']
const jitoCliOp1 = [...jitoCli, '--keypair', '../keys/op1-admin.json']
const jitoCliUser = [...jitoCli, '--keypair', '../keys/user.json']

describe("mini-ncn", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const nextEpoch = async () => {
    const epochInfo = await provider.connection.getEpochInfo();
    const lastSlot = epochInfo.absoluteSlot - epochInfo.slotIndex + epochInfo.slotsInEpoch;
    console.log('current slot', epochInfo.absoluteSlot, 'waiting for slot', lastSlot);

    return new Promise<void>((resolve) => {
      let subscriptionId: number;
      subscriptionId = provider.connection.onSlotChange(({ slot }) => {
        if (slot > lastSlot) {
          provider.connection.removeSlotChangeListener(subscriptionId);
          resolve();
        }
      })
    })
  }

  const miniNcn = anchor.workspace.MiniNcn as Program<MiniNcn>;

  let ncnPubkey: web3.PublicKey;
  let vaultPubkey: web3.PublicKey;
  let vaultAdminPubkey: web3.PublicKey;

  let stMint: web3.Keypair;
  let adminStTokenAccount: web3.PublicKey;

  const rewardsTokenProgram = spl.TOKEN_PROGRAM_ID;
  let rewardsMint: web3.Keypair;
  let rewardsTokenAccount: web3.PublicKey;
  let funderTokenAccount: web3.PublicKey;

  let configPubkey: web3.PublicKey;
  let ballotBoxPubkey: web3.PublicKey;

  before(async () => {
    // prepare NCN
    await provider.connection.requestAirdrop(jitoAdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(op0AdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(op1AdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(userKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await Bun.sleep(500);

    // those configs are initialized by jito
    await $`${jitoCliAdmin} restaking config initialize`
    await $`${jitoCliAdmin} vault config initialize 10 ${jitoAdminKeypair.publicKey}`

    // prepare rewards token
    rewardsMint = web3.Keypair.generate();
    await spl.createMint(
      provider.connection,
      provider.wallet.payer,
      authority.publicKey,
      null,
      9,
      rewardsMint,
      null,
      rewardsTokenProgram,
    )

    funderTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      rewardsMint.publicKey,
      authority.publicKey,
      null,
      rewardsTokenProgram,
    )
  });

  it("initialize ncn", async () => {
    const base = web3.Keypair.generate();
    const tx = miniNcn.methods
      .initializeNcn()
      .accountsPartial({
        base: base.publicKey,
        authority: authority.publicKey,
        rewardsMint: rewardsMint.publicKey,
        rewardsTokenProgram,
      })
      .signers([authority, base])

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    ncnPubkey = pubkeys.ncn;

    rewardsTokenAccount = spl.getAssociatedTokenAddressSync(
      rewardsMint.publicKey,
      pubkeys.ncnAdmin,
      true,
      rewardsTokenProgram,
    )

    await tx.rpc();

    configPubkey = pubkeys.config;

    const config = await miniNcn.account.config.fetch(configPubkey);
    assert.ok(config.authority.equals(authority.publicKey));

    const ncnAdmin = await provider.connection.getAccountInfo(pubkeys.ncnAdmin);
    console.log('ncn admin', ncnAdmin);
  })


  it("initialize ballot box", async () => {
    const tx = miniNcn.methods
      .initializeBallotBox()
      .accountsPartial({
        config: configPubkey,
        authority: authority.publicKey,
      })
      .signers([authority])

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    const signature = await tx.rpc();

    ballotBoxPubkey = pubkeys.ballotBox;

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.ok(ballotBox.config.equals(configPubkey));

  });


  it("initialize vault", async () => {
    stMint = web3.Keypair.generate();

    await spl.createMint(
      provider.connection,
      provider.wallet.payer,
      authority.publicKey,
      null,
      9,
      stMint,
    )

    const vrtMint = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vrt_mint'), stMint.publicKey.toBuffer()],
      miniNcn.programId
    )[0];

    const burnVault = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('burn_vault'), configPubkey.toBuffer()],
      JITO_VAULT_ID
    )[0];

    const burnVaultVrtTokenAccount = anchor.utils.token.associatedAddress({
      mint: vrtMint,
      owner: burnVault,
    });

    vaultPubkey = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), configPubkey.toBuffer()],
      JITO_VAULT_ID
    )[0];

    vaultAdminPubkey = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault_admin'), vaultPubkey.toBuffer()],
      miniNcn.programId
    )[0];

    const vaultStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      stMint.publicKey,
      vaultPubkey,
      null,
      spl.TOKEN_PROGRAM_ID,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    )

    adminStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      stMint.publicKey,
      vaultAdminPubkey,
      null,
      spl.TOKEN_PROGRAM_ID,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    )

    await spl.mintTo(
      provider.connection,
      provider.wallet.payer,
      stMint.publicKey,
      adminStTokenAccount,
      authority,
      web3.LAMPORTS_PER_SOL * 1000,
    )

    const tx = miniNcn.methods
      .initializeVault(new BN(1_000))
      .accountsPartial({
        config: configPubkey,
        stMint: stMint.publicKey,
        authority: authority.publicKey,
        burnVaultVrtTokenAccount,
      })
      .signers([authority]);

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    const signature = await tx.rpc();

    const vaultStTokenAccountInfo = await spl.getAccount(provider.connection, pubkeys.vaultStTokenAccount);
    assert.equal(vaultStTokenAccountInfo.amount, 1_000n);

    const vaultAdmin = await provider.connection.getAccountInfo(pubkeys.vaultAdmin);
    console.log('vault admin', vaultAdmin);
  })


  let op0Pubkey: web3.PublicKey;
  let op1Pubkey: web3.PublicKey;
  it("initialize operators", async () => {
    // operators can initialize their own accounts
    const op0Output = await $`${jitoCliOp0} restaking operator initialize 1000`
    op0Pubkey = getInitializedAddress(op0Output.stderr.toString());

    const op1Output = await $`${jitoCliOp1} restaking operator initialize 2000`
    op1Pubkey = getInitializedAddress(op1Output.stderr.toString());

    const tx = miniNcn.methods
      .initializeOperator()
      .accounts({
        config: configPubkey,
        operatorAdmin: op0AdminKeypair.publicKey,
        operator: op0Pubkey,
      })
      .signers([op0AdminKeypair]);

    debugPubkeys(await tx.pubkeys());
    await tx.rpc();

    await miniNcn.methods
      .initializeOperator()
      .accounts({
        config: configPubkey,
        operatorAdmin: op1AdminKeypair.publicKey,
        operator: op1Pubkey,
      })
      .signers([op1AdminKeypair])
      .rpc()
  })


  it("user mint vrt", async () => {
    const userStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      stMint.publicKey,
      userKeypair.publicKey,
    )

    await spl.mintTo(
      provider.connection,
      provider.wallet.payer,
      stMint.publicKey,
      userStTokenAccount,
      authority,
      web3.LAMPORTS_PER_SOL * 100,
    )

    const userStTokenAccountInfo = await spl.getAccount(provider.connection, userStTokenAccount);
    assert.equal(userStTokenAccountInfo.amount, BigInt(web3.LAMPORTS_PER_SOL * 100));

    // this step is user converting st to vrt
    await $`${jitoCliUser} vault vault mint-vrt ${vaultPubkey} 1234567890 1234567890`

    // delegate to operators
    await miniNcn.methods
      .delegateOperator(new BN(234567890))
      .accounts({
        config: configPubkey,
        operator: op0Pubkey,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    await miniNcn.methods
      .delegateOperator(new BN(1000000000))
      .accounts({
        config: configPubkey,
        operator: op1Pubkey,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  })


  let userRewards;
  let rewardsTree: MerkleTree;

  it("propose", async () => {
    await nextEpoch();

    userRewards = [{
      user: op0AdminKeypair.publicKey,
      amount: 123456789n,
    }, {
      user: op1AdminKeypair.publicKey,
      amount: 987654321n,
    }];

    rewardsTree = buildRewardsTree(userRewards);

    const data = Array.from(rewardsTree.root);
    const tx = miniNcn.methods
      .propose(data)
      .accounts({
        config: configPubkey,
        authority: authority.publicKey,
      })
      .signers([authority])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.deepEqual(ballotBox.proposedRewardsRoot, data);
  });


  it("op0 vote", async () => {
    const tx = miniNcn.methods
      .vote({
        approved: true
      })
      .accounts({
        config: configPubkey,
        operatorAdmin: op0AdminKeypair.publicKey,
        operator: op0Pubkey,
      })
      .signers([op0AdminKeypair])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.equal(ballotBox.operatorsVoted.toNumber(), 1);
    assert.equal(ballotBox.approvedVotes.toNumber(), 234567890);
  });


  it("check consensus", async () => {
    const tx = await miniNcn.methods
      .checkConsensus()
      .accounts({
        config: configPubkey,
        authority: authority.publicKey,
      })
      .signers([authority])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.isNotNull(ballotBox.proposedRewardsRoot);
  })


  it("op1 vote", async () => {
    const tx = miniNcn.methods
      .vote({
        approved: true
      })
      .accounts({
        config: configPubkey,
        operatorAdmin: op1AdminKeypair.publicKey,
        operator: op1Pubkey,
      })
      .signers([op1AdminKeypair])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.equal(ballotBox.operatorsVoted.toNumber(), 2);
    assert.equal(ballotBox.approvedVotes.toNumber(), 1234567890);
  });


  it("check consensus again", async () => {
    await miniNcn.methods
      .checkConsensus()
      .accounts({
        config: configPubkey,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.isNull(ballotBox.proposedRewardsRoot);
  })

  const fundAmount = 1000_000_000_000n;
  it("fund rewards", async () => {
    await spl.mintToChecked(
      provider.connection,
      provider.wallet.payer,
      rewardsMint.publicKey,
      funderTokenAccount,
      authority,
      1000_000_000_000,
      9,
      [],
      null,
      rewardsTokenProgram,
    )

    const tx = miniNcn.methods
      .fundRewards(new BN(fundAmount.toString()))
      .accounts({
        config: configPubkey,
        rewardsMint: rewardsMint.publicKey,
        funder: authority.publicKey,
        fundTokenAccount: funderTokenAccount,
        rewardsTokenProgram,
      })
      .signers([authority])

    debugPubkeys(await tx.pubkeys());
    await tx.rpc();

    const rewardsTokenAccountInfo = await spl.getAccount(provider.connection, rewardsTokenAccount);
    assert.equal(rewardsTokenAccountInfo.amount, fundAmount);
  })

  it("claim rewards for op0", async () => {
    const { proof, leafIndex, root } = rewardsTree.getProof(0)

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.deepEqual(ballotBox.rewardsRoot, Array.from(root));

    const beneficiaryTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      rewardsMint.publicKey,
      op0AdminKeypair.publicKey,
      null,
      rewardsTokenProgram,
    )

    const tx = miniNcn.methods
      .claimRewards({
        index: leafIndex,
        totalRewards: new BN(userRewards[leafIndex].amount.toString()),
        proof: proof.map(node => Array.from(node)),
      })
      .accounts({
        config: configPubkey,
        rewardsMint: rewardsMint.publicKey,
        owner: op0AdminKeypair.publicKey,
        beneficiaryTokenAccount,
        rewardsTokenProgram,
      })
      .signers([op0AdminKeypair])

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    await tx.rpc();

    const rewardsStateAfter = await miniNcn.account.rewardsState.fetch(pubkeys.rewardsState);
    assert.equal(rewardsStateAfter.claimedRewards.toString(), userRewards[leafIndex].amount.toString());

    const rewardsTokenAccountInfo = await spl.getAccount(provider.connection, rewardsTokenAccount);
    assert.equal(rewardsTokenAccountInfo.amount, fundAmount - userRewards[leafIndex].amount);

    const beneficiaryTokenAccountInfo = await spl.getAccount(provider.connection, beneficiaryTokenAccount);
    assert.equal(beneficiaryTokenAccountInfo.amount, userRewards[leafIndex].amount);
  });
});
