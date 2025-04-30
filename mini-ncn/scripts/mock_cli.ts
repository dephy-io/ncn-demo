import { vote, getProvider, getMiniNcnProgram, propose, checkConsensus } from './actions';
import { Command } from '@commander-js/extra-typings';
import * as anchor from '@coral-xyz/anchor';
import { web3 } from '@coral-xyz/anchor';
import { keccak_256 } from 'js-sha3'
import { MiniNcn } from '../target/types/mini_ncn';

const cli = new Command();

let miniNcn: anchor.Program<MiniNcn>;

async function fetchBallotBox(configPubkey: web3.PublicKey) {
  const [ballotBoxPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from('ballot_box'), configPubkey.toBuffer()],
    miniNcn.programId
  );

  return await miniNcn.account.ballotBox.fetch(ballotBoxPda);
}

function calcMockedRoot(epoch: number) {
  return keccak_256.digest(`MOCKED_ROOT:${epoch}`);
}

cli
  .command('run-proposer')
  .requiredOption('-k, --keypair <path>', 'NCN admin keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .option('--interval <seconds>', 'Polling interval in seconds', '600')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
    anchor.setProvider(provider);
    miniNcn = getMiniNcnProgram();
    const configPubkey = new web3.PublicKey(opts.config);

    let ballotBox = await fetchBallotBox(configPubkey);
    console.log(`Last proposed at epoch ${ballotBox.epoch.toNumber()}`);
    while(true) {
      const { epoch } = await provider.connection.getEpochInfo();
      ballotBox = await fetchBallotBox(configPubkey);

      if (epoch > ballotBox.epoch.toNumber()) {
        if (ballotBox.proposedRewardsRoot == null) {
          console.log(`Proposing rewards root for epoch ${epoch}`);
          const root = calcMockedRoot(epoch);
          await propose(provider, { config: opts.config, root });
        } else {
          console.log(`Checking consensus for epoch ${epoch}`);
          await checkConsensus(provider, { config: opts.config });
        }
      }

      await new Promise(r => setTimeout(r, Number(opts.interval) * 1000));
    }
  })

cli
  .command('run-voter')
  .requiredOption('-k, --keypair <path>', 'Operator admin keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .option('--interval <seconds>', 'Polling interval in seconds', '600')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
    anchor.setProvider(provider);
    miniNcn = getMiniNcnProgram();
    const configPubkey = new web3.PublicKey(opts.config);
    const operatorPubkey = new web3.PublicKey(opts.operator);

    const [voterStateAddress] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('voter_state'), configPubkey.toBuffer(), operatorPubkey.toBuffer()],
      miniNcn.programId
    );

    async function shouldApprove(epoch: number): Promise<boolean | null> {
      const ballotBox = await fetchBallotBox(configPubkey);
      if (!ballotBox.epoch.eqn(epoch)) {
        return null;
      }

      if (ballotBox.proposedRewardsRoot == null) {
        return null;
      }

      const mockedRoot = calcMockedRoot(epoch);
      if (ballotBox.proposedRewardsRoot == mockedRoot) {
        return true;
      }

      return false
    }

    const voterState = await miniNcn.account.voterState.fetch(voterStateAddress)
    let lastVotedEpoch = voterState.lastVotedEpoch.toNumber();
    console.log(`Last voted at epoch ${lastVotedEpoch}`);
    while (true) {
      const { epoch } = await provider.connection.getEpochInfo();
      if (epoch > lastVotedEpoch) {
        try {
          console.log(`Detected new epoch: ${epoch}, checking ballot box...`);
          const approved = await shouldApprove(epoch);
          if (approved !== null) {
            await vote(provider, { config: opts.config, operator: opts.operator, approved });
            lastVotedEpoch = epoch;
            console.log(`Voted for epoch ${epoch} ${approved}`);
          }
        } catch (e) {
          console.error(`Vote failed:`, e);
        }
      }

      await new Promise(r => setTimeout(r, Number(opts.interval) * 1000));
    }
  });

cli.parseAsync(process.argv);


