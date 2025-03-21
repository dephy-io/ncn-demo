import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token"
import { MiniNcn } from "../target/types/mini_ncn";
import { assert } from "chai";
import { $ } from "bun";
import { readFileSync } from "fs";

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

const jitoCli = ['jito-restaking-cli', '--rpc-url', 'http://127.0.0.1:8899']
const jitoCliAdmin = [...jitoCli, '--keypair', '../keys/jito-admin.json']
const jitoCliOp0 = [...jitoCli, '--keypair', '../keys/op0-admin.json']
const jitoCliOp1 = [...jitoCli, '--keypair', '../keys/op1-admin.json']
const jitoCliUser = [...jitoCli, '--keypair', '../keys/user.json']

describe("mini-ncn", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const miniNcn = anchor.workspace.MiniNcn as Program<MiniNcn>;

  let ncnPubkey: web3.PublicKey;
  let vaultPubkey: web3.PublicKey;

  let mint: web3.Keypair;
  let adminStTokenAccount: web3.PublicKey;
  
  let configPubkey: web3.PublicKey;
  let ballotBoxPubkey: web3.PublicKey;

  before(async () => {
    // prepare NCN
    await provider.connection.requestAirdrop(jitoAdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(op0AdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(op1AdminKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await provider.connection.requestAirdrop(userKeypair.publicKey, web3.LAMPORTS_PER_SOL * 10)
    await Bun.sleep(400);

    await $`${jitoCliAdmin} restaking config initialize`

    const output = await $`${jitoCliAdmin} restaking ncn initialize`
    ncnPubkey = getInitializedAddress(output.stderr.toString())

    mint = web3.Keypair.generate();

    await spl.createMint(
      provider.connection,
      provider.wallet.payer,
      jitoAdminKeypair.publicKey,
      null,
      9,
      mint,
    )

    adminStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint.publicKey,
      jitoAdminKeypair.publicKey,
    )

    await spl.mintTo(
      provider.connection,
      provider.wallet.payer,
      mint.publicKey,
      adminStTokenAccount,
      jitoAdminKeypair,
      web3.LAMPORTS_PER_SOL * 1000,
    )

    // prepare jito vault
    await $`${jitoCliAdmin} vault config initialize 10 ${jitoAdminKeypair.publicKey}`
  });

  it("initialize", async () => {
    const tx = await miniNcn.methods
      .initialize()
      .accounts({
        ncn: ncnPubkey,
        authority: jitoAdminKeypair.publicKey,
      })
      .signers([jitoAdminKeypair])

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    const signature = await tx.rpc();

    configPubkey = pubkeys.config;
    ballotBoxPubkey = pubkeys.ballotBox;

    const config = await miniNcn.account.config.fetch(configPubkey);
    assert.ok(config.authority.equals(jitoAdminKeypair.publicKey));

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.ok(ballotBox.config.equals(configPubkey));

  });


  it("initialize vault", async () => {
    const vrtMint = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vrt_mint'), mint.publicKey.toBuffer()],
      miniNcn.programId
    )[0];

    const vault = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), configPubkey.toBuffer()],
      JITO_VAULT_ID
    )[0];

    const burnVault = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('burn_vault'), configPubkey.toBuffer()],
      JITO_VAULT_ID
    )[0];

    const burnVaultVrtTokenAccount = anchor.utils.token.associatedAddress({
      mint: vrtMint,
      owner: burnVault,
    });

    const vaultStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint.publicKey,
      vault,
      null,
      spl.TOKEN_PROGRAM_ID,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    )

    const tx = miniNcn.methods
      .initializeVault(new BN(1_000_000_000))
      .accountsPartial({
        ncn: ncnPubkey,
        vault,
        stMint: mint.publicKey,
        admin: jitoAdminKeypair.publicKey,
        adminStTokenAccount,
        vaultStTokenAccount,
        vrtMint: vrtMint,
        burnVaultVrtTokenAccount,
      })
      .signers([jitoAdminKeypair]);

    const pubkeys = await tx.pubkeys();
    debugPubkeys(pubkeys);

    const signature = await tx.rpc();

    vaultPubkey = pubkeys.vault;

    const vaultStTokenAccountInfo = await spl.getAccount(provider.connection, pubkeys.vaultStTokenAccount);
    assert.equal(vaultStTokenAccountInfo.amount, 1_000_000_000n);
  })


  let op0Pubkey: web3.PublicKey;
  let op1Pubkey: web3.PublicKey;
  it("initialize operators", async () => {
    const op0Output = await $`${jitoCliOp0} restaking operator initialize 1000`
    op0Pubkey = getInitializedAddress(op0Output.stderr.toString());
    await $`${jitoCliOp0} restaking operator initialize-operator-vault-ticket ${op0Pubkey} ${vaultPubkey}`
    await $`${jitoCliAdmin} vault vault initialize-operator-delegation ${vaultPubkey} ${op0Pubkey}`

    const op1Output = await $`${jitoCliOp1} restaking operator initialize 2000`
    op1Pubkey = getInitializedAddress(op1Output.stderr.toString());
    await $`${jitoCliOp1} restaking operator initialize-operator-vault-ticket ${op1Pubkey} ${vaultPubkey}`
    await $`${jitoCliAdmin} vault vault initialize-operator-delegation ${vaultPubkey} ${op1Pubkey}`

    // await $`${jitoCli} restaking operator list`
  })


  it("user mint vrt", async () => {
    const userStTokenAccount = await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint.publicKey,
      userKeypair.publicKey,
    )

    await spl.mintTo(
      provider.connection,
      provider.wallet.payer,
      mint.publicKey,
      userStTokenAccount,
      jitoAdminKeypair,
      web3.LAMPORTS_PER_SOL * 100,
    )

    const userStTokenAccountInfo = await spl.getAccount(provider.connection, userStTokenAccount);
    assert.equal(userStTokenAccountInfo.amount, BigInt(web3.LAMPORTS_PER_SOL * 100));

    await $`${jitoCliUser} vault vault mint-vrt ${vaultPubkey} 1234567890 1234567890`

    // delegate to operators
    await $`${jitoCliAdmin} vault vault delegate-to-operator ${vaultPubkey} ${op0Pubkey} 234567890`
    await $`${jitoCliAdmin} vault vault delegate-to-operator ${vaultPubkey} ${op1Pubkey} 1000000000`
  })


  it("propose", async () => {
    const data = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    const tx = miniNcn.methods
      .propose(data)
      .accountsPartial({
        config: configPubkey,
        ballotBox: ballotBoxPubkey,
        authority: jitoAdminKeypair.publicKey,
      })
      .signers([jitoAdminKeypair])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.deepEqual(ballotBox.state, data);
  });


  it("vote", async () => {
    const tx = await miniNcn.methods
      .vote(true)
      .accounts({
        ballotBox: ballotBoxPubkey,
        operatorAdmin: op0AdminKeypair.publicKey,
        operator: op0Pubkey,
        vault: vaultPubkey,
      })
      .signers([op0AdminKeypair])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.equal(ballotBox.operatorsVoted.toNumber(), 1);
    assert.equal(ballotBox.approvedVotes.toNumber(), 234567890);
    assert.equal(ballotBox.operators[0].toString(), op0AdminKeypair.publicKey.toString());
  });


  it("check consensus", async () => {
    const tx = await miniNcn.methods
      .checkConsensus()
      .accountsPartial({
        ballotBox: ballotBoxPubkey,
        authority: jitoAdminKeypair.publicKey,
        vault: vaultPubkey,
      })
      .signers([jitoAdminKeypair])

    debugPubkeys(await tx.pubkeys());

    await tx.rpc();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.isNotNull(ballotBox.state);
  })


  it("check consensus after vote window", async () => {
    // wait for vote window to pass
    await Bun.sleep(4000);

    const {signature, pubkeys} = await miniNcn.methods
      .checkConsensus()
      .accountsPartial({
        ballotBox: ballotBoxPubkey,
        authority: jitoAdminKeypair.publicKey,
        vault: vaultPubkey,
      })
      .signers([jitoAdminKeypair])
      .rpcAndKeys();

    const ballotBox = await miniNcn.account.ballotBox.fetch(ballotBoxPubkey);
    assert.isNull(ballotBox.state);
  })
});
