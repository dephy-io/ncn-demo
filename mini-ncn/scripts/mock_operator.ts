import { vote, getProvider, getMiniNcnProgram } from './actions';
import { Command } from '@commander-js/extra-typings';
import { Connection, clusterApiUrl, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { keccak_256 } from 'js-sha3'

const cli = new Command();

cli
  .requiredOption('-k, --keypair <path>', 'Operator admin keypair JSON file path')
  .requiredOption('-r, --rpc <url>', 'Solana RPC URL')
  .requiredOption('--config <pubkey>', 'Config public key')
  .requiredOption('--operator <pubkey>', 'Operator public key')
  .option('--interval <seconds>', 'Polling interval in seconds', '300')
  .action(async (opts) => {
    const provider = getProvider(opts.rpc, opts.keypair);
    const connection = new Connection(opts.rpc || clusterApiUrl('devnet'));
    anchor.setProvider(provider);
    const miniNcn = getMiniNcnProgram();
    const configPubkey = new PublicKey(opts.config);
    const operatorPubkey = new PublicKey(opts.operator);

    const [voterStateAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from('voter_state'), configPubkey.toBuffer(), operatorPubkey.toBuffer()],
      miniNcn.programId
    );

    const [ballotBoxPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('ballot_box'), configPubkey.toBuffer()],
      miniNcn.programId
    );

    async function getEpoch(): Promise<number> {
      const epochInfo = await connection.getEpochInfo();
      return epochInfo.epoch;
    }

    async function fetchBallotBox() {
      try {
        return await miniNcn.account.ballotBox.fetch(ballotBoxPda);
      } catch (e) {
        console.error('Failed to fetch BallotBox:', e);
        return null;
      }
    }

    function calcMockedRoot(epoch: number) {
      return keccak_256.digest(`MOCKED_ROOT:${epoch}`);
    }

    async function shouldApprove(epoch: number): Promise<boolean | null> {
      const ballotBox = await fetchBallotBox();
      if (ballotBox.epoch.gten(epoch)) {
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
    console.log(`Starting loop at epoch ${lastVotedEpoch}`);
    while (true) {
      const epoch = await getEpoch();
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


