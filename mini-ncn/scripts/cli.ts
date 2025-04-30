import { Command } from '@commander-js/extra-typings';
import {
  initializeNcn,
  initializeVault,
  initializeOperator,
  delegateOperator,
  propose,
  vote,
  checkConsensus,
  fundRewards,
  claimRewards,
  initializeBallotBox,
  getProvider,
} from './actions';
import { AnchorProvider } from '@coral-xyz/anchor';


const cli = new Command();

let provider: AnchorProvider

cli
  .name('mini-ncn-cli')
  .description('Mini NCN Anchor Program CLI')
  .version('0.1.0')
  .requiredOption('-k, --keypair <path>', 'Authority keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .hook('preAction', (thisCmd) => {
    const { rpc, keypair } = thisCmd.opts();
    if (rpc && keypair) {
      provider = getProvider(rpc, keypair);
    }
  });

cli.command('initialize-ncn')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .action(async (opts) => {
    await initializeNcn(provider, opts);
  });

cli.command('initialize-vault')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--st-mint <pubkey>', 'Stake mint public key')
  .requiredOption('--amount <amount>', 'Initial token amount')
  .action(async (opts) => {
    await initializeVault(provider, opts);
  });

cli.command('initialize-operator')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .action(async (opts) => {
    await initializeOperator(provider, opts);
  });

cli.command('delegate-operator')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .requiredOption('--amount <amount>', 'Delegation amount')
  .action(async (opts) => {
    await delegateOperator(provider, opts);
  });

cli.command('propose')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--root <hex>', 'Merkle root (hex string)')
  .action(async (opts) => {
    const root = Array.from(Buffer.from(opts['root'], 'hex'));
    await propose(provider, {...opts, root});
  });

cli.command('vote')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .option('--approved', 'Approve the proposal')
  .action(async (opts) => {
    await vote(provider, opts);
  });

cli.command('check-consensus')
  .requiredOption('--config <pubkey>', 'Config public key')
  .action(async (opts) => {
    await checkConsensus(provider, opts);
  });

cli.command('fund-rewards')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .requiredOption('--amount <amount>', 'Amount to fund (integer)')
  .action(async (opts) => {
    await fundRewards(provider, opts);
  });

cli.command('claim-rewards')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--rewards-mint <pubkey>', 'Rewards mint public key')
  .requiredOption('--index <number>', 'Merkle leaf index')
  .requiredOption('--total-rewards <amount>', 'Total rewards to claim')
  .requiredOption('--proof <hex>', 'Merkle proof (comma-separated hex nodes)')
  .action(async (opts) => {
    await claimRewards(provider, opts);
  });

cli.command('initialize-ballot-box')
  .requiredOption('--config <pubkey>', 'Config public key')
  .action(async (opts) => {
    await initializeBallotBox(provider, opts);
  });

cli.parseAsync(process.argv);
