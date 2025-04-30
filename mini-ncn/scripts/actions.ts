import * as anchor from '@coral-xyz/anchor';
import { BN, web3 } from '@coral-xyz/anchor';
import * as spl from '@solana/spl-token';
import { type MiniNcn } from '../target/types/mini_ncn';
import { readFileSync } from 'fs';

export function loadKey(path: string) {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

export function getProvider(rpcUrl: string, keypairPath: string) {
  const wallet = new anchor.Wallet(loadKey(keypairPath));
  const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpcUrl), wallet, {});
  anchor.setProvider(provider);
  return provider;
}

export function getMiniNcnProgram() {
  return anchor.workspace.MiniNcn as anchor.Program<MiniNcn>;
}

export function debugPubkeys(pubkeys: Record<string, any>) {
  for (const name in pubkeys) {
    console.log(name, pubkeys[name].toString());
  }
}

export const JITO_VAULT_ID = new web3.PublicKey("Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8");

export interface InitializeNcnOpts {
  rewardsMint: string;
}
export async function initializeNcn(provider: anchor.AnchorProvider, opts: InitializeNcnOpts) {
  const miniNcn = getMiniNcnProgram();
  const base = web3.Keypair.generate();
  const rewardsMint = new web3.PublicKey(opts['rewardsMint']);
  const mintAccount = await provider.connection.getAccountInfo(rewardsMint)
  const rewardsTokenProgram = mintAccount.owner;

  const tx = miniNcn.methods
    .initializeNcn()
    .accounts({
      base: base.publicKey,
      authority: provider.wallet.publicKey,
      rewardsMint,
      rewardsTokenProgram,
    })
    .signers([provider.wallet.payer, base]);
  const pubkeys = await tx.pubkeys();
  debugPubkeys(pubkeys);
  await tx.rpc();
  console.log('NCN initialized successfully!');
}


export interface InitializeVaultOpts {
  config: string;
  stMint: string;
  amount: string;
}
export async function initializeVault(provider: anchor.AnchorProvider, opts: InitializeVaultOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const stMint = new web3.PublicKey(opts['stMint']);
  const stMintAccount = await provider.connection.getAccountInfo(stMint);
  const stMintTokenProgram = stMintAccount.owner;

  const vaultPubkey = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), config.toBuffer()],
    JITO_VAULT_ID
  )[0];

  const vaultAdminPubkey = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vault_admin'), vaultPubkey.toBuffer()],
    miniNcn.programId
  )[0];

  const vaultStTokenAccount = spl.getAssociatedTokenAddressSync(stMint, vaultPubkey, true, stMintTokenProgram)
  if (!await provider.connection.getAccountInfo(vaultStTokenAccount)) {
    await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      stMint,
      vaultPubkey,
      null,
      stMintTokenProgram,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    )
  }

  const adminStTokenAccount = spl.getAssociatedTokenAddressSync(stMint, vaultAdminPubkey, true, stMintTokenProgram)
  if (!await provider.connection.getAccountInfo(adminStTokenAccount)) {
    await spl.createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      stMint,
      vaultAdminPubkey,
      null,
      stMintTokenProgram,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      true,
    )
  }

  const vrtMint = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('vrt_mint'), stMint.toBuffer()],
    miniNcn.programId
  )[0];
  const burnVault = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('burn_vault'), config.toBuffer()],
    JITO_VAULT_ID
  )[0];
  const burnVaultVrtTokenAccount = spl.getAssociatedTokenAddressSync(vrtMint, burnVault, true, spl.TOKEN_PROGRAM_ID);
  const amount = new BN(opts['amount']);
  const tx = miniNcn.methods
    .initializeVault({
      initializeTokenAmount: amount,
      depositFeeBps: 0,
      withdrawalFeeBps: 0,
      rewardFeeBps: 0,
    })
    .accountsPartial({
      config,
      vaultStTokenAccount,
      adminStTokenAccount,
      stMint,
      authority: provider.wallet.publicKey,
      burnVaultVrtTokenAccount,
    })
    .signers([provider.wallet.payer]);
  const pubkeys = await tx.pubkeys();
  debugPubkeys(pubkeys);
  await tx.rpc();
  console.log('Vault initialized!');
}


export interface InitializeOperatorOpts {
  config: string;
  operator: string;
}
export async function initializeOperator(provider: anchor.AnchorProvider, opts: InitializeOperatorOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const operator = new web3.PublicKey(opts['operator']);
  const tx = miniNcn.methods
    .initializeOperator()
    .accounts({
      config,
      operatorAdmin: provider.wallet.publicKey,
      operator,
    })
    .signers([provider.wallet.payer]);
  const pubkeys = await tx.pubkeys();
  debugPubkeys(pubkeys);
  await tx.rpc();
  console.log('Operator initialized!');
}


export interface DelegateOperatorOpts {
  config: string;
  operator: string;
  amount: string;
}
export async function delegateOperator(provider: anchor.AnchorProvider, opts: DelegateOperatorOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const operator = new web3.PublicKey(opts['operator']);
  const amount = new BN(opts['amount']);
  const tx = miniNcn.methods
    .delegateOperator(amount)
    .accounts({
      config,
      operator,
      authority: provider.wallet.publicKey,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Operator delegated!');
}


export interface ProposeOpts {
  config: string;
  root: string;
}
export async function propose(provider: anchor.AnchorProvider, opts: ProposeOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const root = Buffer.from(opts['root'], 'hex');
  const tx = miniNcn.methods
    .propose(Array.from(root))
    .accounts({
      config,
      authority: provider.wallet.publicKey,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Proposal submitted!');
}


export interface VoteOpts {
  config: string;
  operator: string;
  approved?: boolean;
}
export async function vote(provider: anchor.AnchorProvider, opts: VoteOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const operator = new web3.PublicKey(opts['operator']);
  const approved = opts['approved'] || false;
  const tx = miniNcn.methods
    .vote({ approved })
    .accounts({
      config,
      operatorAdmin: provider.wallet.publicKey,
      operator,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Vote submitted!');
}


export interface CheckConsensusOpts {
  config: string;
}
export async function checkConsensus(provider: anchor.AnchorProvider, opts: CheckConsensusOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const tx = miniNcn.methods
    .checkConsensus()
    .accounts({
      config,
      authority: provider.wallet.publicKey,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Consensus checked!');
}


export interface FundRewardsOpts {
  config: string;
  rewardsMint: string;
  amount: string;
}
export async function fundRewards(provider: anchor.AnchorProvider, opts: FundRewardsOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const rewardsMint = new web3.PublicKey(opts['rewardsMint']);
  const mintAccount = await provider.connection.getAccountInfo(rewardsMint);
  const rewardsTokenProgram = mintAccount.owner;
  const fundTokenAccount = await anchor.utils.token.associatedAddress({
    mint: rewardsMint,
    owner: provider.wallet.publicKey,
  });
  const amount = new BN(opts['amount']);
  const tx = miniNcn.methods
    .fundRewards(amount)
    .accounts({
      config,
      rewardsMint,
      funder: provider.wallet.publicKey,
      fundTokenAccount,
      rewardsTokenProgram,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Rewards funded!');
}


export interface ClaimRewardsOpts {
  config: string;
  rewardsMint: string;
  index: string;
  totalRewards: string;
  proof: string;
}
export async function claimRewards(provider: anchor.AnchorProvider, opts: ClaimRewardsOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const rewardsMint = new web3.PublicKey(opts['rewardsMint']);
  const mintAccount = await provider.connection.getAccountInfo(rewardsMint);
  const rewardsTokenProgram = mintAccount.owner;
  const beneficiaryTokenAccount = await anchor.utils.token.associatedAddress({
    mint: rewardsMint,
    owner: provider.wallet.publicKey,
  });
  const index = Number(opts['index']);
  const totalRewards = new BN(opts['totalRewards']);
  const proof = opts['proof'].split(',').map((h: string) => Array.from(Buffer.from(h, 'hex')));
  const tx = miniNcn.methods
    .claimRewards({ index, totalRewards, proof })
    .accounts({
      config,
      rewardsMint,
      owner: provider.wallet.publicKey,
      beneficiaryTokenAccount,
      rewardsTokenProgram,
    })
    .signers([provider.wallet.payer]);
  await tx.rpc();
  console.log('Rewards claimed!');
}


export interface InitializeBallotBoxOpts {
  config: string;
}
export async function initializeBallotBox(provider: anchor.AnchorProvider, opts: InitializeBallotBoxOpts) {
  const miniNcn = getMiniNcnProgram();
  const config = new web3.PublicKey(opts['config']);
  const tx = miniNcn.methods
    .initializeBallotBox()
    .accountsPartial({
      config,
      authority: provider.wallet.publicKey,
    })
    .signers([provider.wallet.payer]);
  const pubkeys = await tx.pubkeys();
  debugPubkeys(pubkeys);
  await tx.rpc();
  console.log('Ballot box initialized!');
}
