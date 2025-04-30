import { Command } from '@commander-js/extra-typings';
import * as anchor from '@coral-xyz/anchor';
import { BN, web3 } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { type MiniNcn } from '../target/types/mini_ncn';
import * as spl from '@solana/spl-token';


function loadKey(path: string) {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

function getProvider(rpcUrl: string, keypairPath: string) {
  const wallet = new anchor.Wallet(loadKey(keypairPath));
  const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpcUrl), wallet, {});
  anchor.setProvider(provider);
  return provider;
}

function getMiniNcnProgram() {
  return anchor.workspace.MiniNcn as anchor.Program<MiniNcn>;
}

const debugPubkeys = (pubkeys) => {
  for (const name in pubkeys) {
    console.log(name, pubkeys[name].toString());
  }
};

const cli = new Command();

cli
  .name('mini-ncn-cli')
  .description('Mini NCN Anchor Program CLI')
  .version('0.1.0');

cli.command('initialize-ncn')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

const JITO_VAULT_ID = new web3.PublicKey("Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8");

cli.command('initialize-vault')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--st-mint <pubkey>', 'Stake mint public key')
  .requiredOption('--amount <amount>', 'Initial token amount')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('initialize-operator')
  .requiredOption('-k, --keypair <path>', 'Operator admin keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('delegate-operator')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .requiredOption('--amount <amount>', 'Delegation amount')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('propose')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--root <hex>', 'Merkle root (hex string)')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('vote')
  .requiredOption('-k, --keypair <path>', 'Operator admin keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .option('--approved', 'Approve the proposal')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
    const miniNcn = getMiniNcnProgram();
    const config = new web3.PublicKey(opts['config']);
    const operator = new web3.PublicKey(opts['operator']);
    const tx = miniNcn.methods
      .vote({ approved: !!opts.approved })
      .accounts({
        config,
        operatorAdmin: provider.wallet.publicKey,
        operator,
      })
      .signers([provider.wallet.payer]);
    await tx.rpc();
    console.log('Vote submitted!');
  });

cli.command('check-consensus')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('fund-rewards')
  .requiredOption('-k, --keypair <path>', 'Funder keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .requiredOption('--amount <amount>', 'Amount to fund (integer)')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('claim-rewards')
  .requiredOption('-k, --keypair <path>', 'Claimer keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .requiredOption('--index <number>', 'Merkle leaf index')
  .requiredOption('--total-rewards <amount>', 'Total rewards to claim')
  .requiredOption('--proof <hex>', 'Merkle proof (comma-separated hex nodes)')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.command('initialize-ballot-box')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
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
  });

cli.parseAsync(process.argv);
