#![allow(unexpected_cfgs)]

use anchor_lang::{prelude::*, solana_program};
use jito_restaking_client::programs::JITO_RESTAKING_ID;
use jito_vault_client::programs::JITO_VAULT_ID;

declare_id!("FMtP7JSgYneYu36nisXubFWTWw6LGC9EFJ6YhjAq6CQr");

declare_program!(spl_account_compression);

const NOOP_PROGRAM: Pubkey = pubkey!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

const MAX_OPERATORS: u64 = 3;

// from spl-merkle-tree-reference
type Node = [u8; 32];

pub fn recompute(mut leaf: Node, proof: &[Node], index: u32) -> Node {
    for (i, s) in proof.iter().enumerate() {
        if index >> i & 1 == 0 {
            let res = solana_program::keccak::hashv(&[&leaf, s.as_ref()]);
            leaf.copy_from_slice(res.as_ref());
        } else {
            let res = solana_program::keccak::hashv(&[s.as_ref(), &leaf]);
            leaf.copy_from_slice(res.as_ref());
        }
    }
    leaf
}


#[program]
pub mod mini_ncn {
    use jito_restaking_client::accounts::{Operator, OperatorVaultTicket};
    use jito_vault_client::accounts::{Vault, VaultOperatorDelegation};

    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.ncn = ctx.accounts.ncn.key();
        config.authority = ctx.accounts.authority.key();

        spl_account_compression::cpi::init_empty_merkle_tree(
            CpiContext::new_with_signer(
                ctx.accounts.compression_program.to_account_info(),
                spl_account_compression::cpi::accounts::InitEmptyMerkleTree {
                    authority: ctx.accounts.ballot_box.to_account_info(),
                    merkle_tree: ctx.accounts.merkle_tree.to_account_info(),
                    noop: ctx.accounts.noop_program.to_account_info(),
                },
                &[
                    &[b"ballot_box", config.key().as_ref(), &[ctx.bumps.ballot_box]],
                ],
            ),
            args.max_depth,
            args.max_buffer_size,
        )?;

        let ballot_box = &mut ctx.accounts.ballot_box;
        ballot_box.config = config.key();
        ballot_box.merkle_tree = ctx.accounts.merkle_tree.key();

        Ok(())
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>, initialize_token_amount: u64) -> Result<()> {
        jito_vault_client::instructions::InitializeVaultCpi::new(
            &ctx.accounts.jito_vault_program,
            jito_vault_client::instructions::InitializeVaultCpiAccounts {
                config: &ctx.accounts.jito_vault_config.to_account_info(),
                base: &ctx.accounts.config.to_account_info(),
                vault: &ctx.accounts.vault.to_account_info(),
                vrt_mint: &ctx.accounts.vrt_mint,
                st_mint: &ctx.accounts.st_mint.to_account_info(),
                admin_st_token_account: &ctx.accounts.admin_st_token_account.to_account_info(),
                vault_st_token_account: &ctx.accounts.vault_st_token_account.to_account_info(),
                burn_vault: &ctx.accounts.burn_vault.to_account_info(),
                burn_vault_vrt_token_account: &ctx.accounts.burn_vault_vrt_token_account,
                admin: &ctx.accounts.admin.to_account_info(),
                system_program: &ctx.accounts.system_program.to_account_info(),
                token_program: &ctx.accounts.token_program.to_account_info(),
                associated_token_program: &ctx.accounts.associated_token_program.to_account_info(),
            },
            jito_vault_client::instructions::InitializeVaultInstructionArgs {
                deposit_fee_bps: 0,
                withdrawal_fee_bps: 0,
                reward_fee_bps: 0,
                decimals: ctx.accounts.st_mint.decimals,
                initialize_token_amount,
            },
        ).invoke_signed(&[
            &[b"mini_ncn", ctx.accounts.config.ncn.as_ref(), &[ctx.bumps.config]],
            &[b"vrt_mint", ctx.accounts.st_mint.key().as_ref(), &[ctx.bumps.vrt_mint]],
        ])?;

        Ok(())
    }

    pub fn initialize_operator(ctx: Context<InitializeOperator>) -> Result<()> {
        // TODO: in order to let users initialize themself, we need to check NCN stuff

        let voter_state = &mut ctx.accounts.voter_state;
        voter_state.config = ctx.accounts.config.key();
        voter_state.operator = ctx.accounts.operator.key();
        voter_state.last_voted_epoch = 0;
        voter_state.claimed_rewards = 0;


        // SKIP: noop log for now
        // wrap_application_data_v1(...)?;

        let leaf = ctx.accounts.operator.key().to_bytes();

        spl_account_compression::cpi::append(
            CpiContext::new_with_signer(
                ctx.accounts.compression_program.to_account_info(),
                spl_account_compression::cpi::accounts::Append {
                    authority: ctx.accounts.ballot_box.to_account_info(),
                    merkle_tree: ctx.accounts.merkle_tree.to_account_info(),
                    noop: ctx.accounts.noop_program.to_account_info(),
                },
                &[
                    &[b"ballot_box", ctx.accounts.config.key().as_ref(), &[ctx.bumps.ballot_box]],
                ],
            ),
            leaf,
        )?;

        Ok(())
    }

    pub fn propose(ctx: Context<Propose>, new_root: [u8; 32]) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;
        let clock = Clock::get()?;

        require!(ballot_box.epoch < clock.epoch, MiniNcnError::InvalidEpoch);
        require!(ballot_box.proposed_rewards_root.is_none(), MiniNcnError::NonEmptyProposedRoot);

        // TODO: maybe set consensus threshold here
        ballot_box.propose(clock.epoch, new_root);

        Ok(())
    }

    // explicitly lifetime is required for remaining_accounts
    pub fn vote<'info>(ctx: Context<'_, '_, '_, 'info, Vote<'info>>, args: VoteArgs) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;
        let voter_state = &mut ctx.accounts.voter_state;

        let clock = Clock::get()?;
        require!(
            clock.epoch == ballot_box.epoch,
            MiniNcnError::InvalidEpoch
        );
        require!(
            clock.epoch > voter_state.last_voted_epoch,
            MiniNcnError::InvalidEpoch
        );

        let operator_index = ballot_box.operators_voted;
        require!(
            operator_index < MAX_OPERATORS,
            MiniNcnError::InvalidOperator
        );

        // TODO: ncn operator ticket stuff

        // verify merkle tree proof
        // TODO: hash node
        let leaf = ctx.accounts.operator.key().to_bytes();

        spl_account_compression::cpi::verify_leaf(
            CpiContext::new_with_signer(
                ctx.accounts.compression_program.to_account_info(),
                spl_account_compression::cpi::accounts::VerifyLeaf { merkle_tree: ctx.accounts.merkle_tree.to_account_info() },
                &[
                    &[b"ballot_box", ctx.accounts.config.key().as_ref(), &[ctx.bumps.ballot_box]],
                ],
            ).with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            args.root,
            leaf,
            args.index
        )?;

        // Vault-Operator
        {
            let _vault = Vault::from_bytes(&ctx.accounts.vault.try_borrow_data()?)?;
        }

        {
            let operator = Operator::from_bytes(&ctx.accounts.operator.try_borrow_data()?)?;
            require!(operator.admin == ctx.accounts.operator_admin.key(), MiniNcnError::InvalidOperator);
        }

        {
            let operator_vault_ticket = OperatorVaultTicket::from_bytes(&ctx.accounts.operator_vault_ticket.try_borrow_data()?)?;
            require!(operator_vault_ticket.operator == ctx.accounts.operator.key(), MiniNcnError::InvalidOperatorVaultTicket);
            require!(operator_vault_ticket.vault == ctx.accounts.vault.key(), MiniNcnError::InvalidOperatorVaultTicket);
        }

        let vault_operator_delegation = VaultOperatorDelegation::from_bytes(&ctx.accounts.vault_operator_delegation.try_borrow_data()?)?;
        require!(vault_operator_delegation.operator == ctx.accounts.operator.key(), MiniNcnError::InvalidOperator);
        require!(vault_operator_delegation.vault == ctx.accounts.vault.key(), MiniNcnError::InvalidVault);

        ballot_box.operators_voted += 1;
        if args.approved {
            ballot_box.approved_votes += vault_operator_delegation.delegation_state.staked_amount;
            msg!(
                "{} Approved at epoch {}",
                ctx.accounts.operator_admin.key(),
                clock.epoch
            );
        }

        voter_state.last_voted_epoch = clock.epoch;

        Ok(())
    }

    pub fn check_consensus(ctx: Context<CheckConsensus>) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;

        let proposed_rewards_root = ballot_box.proposed_rewards_root.ok_or(MiniNcnError::EmptyProposedRoot)?;

        let vault = Vault::from_bytes(&ctx.accounts.vault.try_borrow_data()?)?;

        let clock = Clock::get()?;
        let consensus_reached = ballot_box.approved_votes > vault.vrt_supply * 2 / 3;

        if consensus_reached {
            msg!("Consensus reached");

            ballot_box.rewards_root = proposed_rewards_root;
            // TODO: transfer rewards
        }

        let vote_window_passed = clock.epoch > ballot_box.epoch;
        if vote_window_passed || consensus_reached {
            ballot_box.proposed_rewards_root = None;
        }

        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>, args: ClaimRewardsArgs) -> Result<()> {
        {
            let operator = Operator::from_bytes(&ctx.accounts.operator.try_borrow_data()?)?;
            require!(operator.admin == ctx.accounts.operator_admin.key(), MiniNcnError::InvalidOperator);
        }

        let leaf = solana_program::keccak::hashv(&[ctx.accounts.operator.key().as_ref(), &args.total_rewards.to_le_bytes()]);
        let computed_root = recompute(leaf.to_bytes(), &args.proof, args.index);

        require!(computed_root == ctx.accounts.ballot_box.rewards_root, MiniNcnError::InvalidProof);

        let voter_state = &mut ctx.accounts.voter_state;

        let _unclaimed_rewards = args.total_rewards - voter_state.claimed_rewards;
        // TODO: transfer unclaimed rewards tokens

        voter_state.claimed_rewards = args.total_rewards;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = payer,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [b"mini_ncn", ncn.key().as_ref()], bump
    )]
    pub config: Account<'info, Config>,
    #[account(init, payer = payer,
        space = BallotBox::DISCRIMINATOR.len() + BallotBox::INIT_SPACE,
        seeds = [b"ballot_box", config.key().as_ref()], bump
    )]
    pub ballot_box: Account<'info, BallotBox>,
    /// CHECK:
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK:
    pub ncn: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub compression_program: Program<'info, spl_account_compression::program::SplAccountCompression>,
    /// CHECK:
    #[account(address = NOOP_PROGRAM)]
    pub noop_program: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigArgs {   
    pub max_depth: u32,
    pub max_buffer_size: u32,
}


#[derive(Accounts)]
pub struct InitializeVault<'info> {
    // /// CHECK:
    // pub ncn: UncheckedAccount<'info>,
    #[account(seeds = [b"mini_ncn", config.ncn.key().as_ref()], bump)]
    pub config: Account<'info, Config>,
    /// CHECK:
    #[account(address = JITO_VAULT_ID)]
    pub jito_vault_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut, seeds = [b"config"], bump, seeds::program = JITO_VAULT_ID)]
    pub jito_vault_config: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut, seeds = [b"vault", config.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub vault: SystemAccount<'info>,
    #[account()]
    pub st_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(mut, associated_token::mint = st_mint, associated_token::authority = admin)]
    pub admin_st_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    #[account(mut, associated_token::mint = st_mint, associated_token::authority = vault)]
    pub vault_st_token_account: Account<'info, anchor_spl::token::TokenAccount>,
    /// CHECK:
    #[account(mut, seeds = [b"vrt_mint", st_mint.key().as_ref()], bump)]
    pub vrt_mint: UncheckedAccount<'info>,
    /// CHECK:
    #[account(seeds = [b"burn_vault", config.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub burn_vault: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address_with_program_id(burn_vault.key, vrt_mint.key, token_program.key))]
    pub burn_vault_vrt_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

#[derive(Accounts)]
pub struct InitializeOperator<'info> {
    #[account(mut, has_one = authority @ MiniNcnError::ConfigMismatch)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"ballot_box", config.key().as_ref()], bump)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(
        init, payer = payer,
        space = VoterState::DISCRIMINATOR.len() + VoterState::INIT_SPACE,
        seeds = [b"voter_state", config.key().as_ref(), operator.key().as_ref()], bump
    )]
    pub voter_state: Account<'info, VoterState>,
    /// CHECK:
    #[account(mut, address = ballot_box.merkle_tree)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK:
    pub operator: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub compression_program: Program<'info, spl_account_compression::program::SplAccountCompression>,
    /// CHECK:
    #[account(address = NOOP_PROGRAM)]
    pub noop_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Propose<'info> {
    #[account(mut, has_one = config @ MiniNcnError::ConfigMismatch)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(has_one = authority @ MiniNcnError::InvalidAuthority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct VoteArgs {
    pub root: [u8; 32],
    pub index: u32,
    pub approved: bool,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"ballot_box", config.key().as_ref()], bump)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(mut, seeds = [b"voter_state", config.key().as_ref(), operator.key().as_ref()], bump)]
    pub voter_state: Account<'info, VoterState>,
    /// CHECK:
    #[account(mut, address = ballot_box.merkle_tree)]
    pub merkle_tree: UncheckedAccount<'info>,
    pub operator_admin: Signer<'info>,
    /// CHECK:
    #[account()]
    pub vault: UncheckedAccount<'info>,
    /// CHECK:
    #[account()]
    pub operator: UncheckedAccount<'info>,
    /// CHECK:
    #[account(seeds = [b"operator_vault_ticket", operator.key().as_ref(), vault.key().as_ref()], bump, seeds::program = JITO_RESTAKING_ID)]
    pub operator_vault_ticket: UncheckedAccount<'info>,
    /// CHECK:
    #[account(seeds = [b"vault_operator_delegation", vault.key().as_ref(), operator.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub vault_operator_delegation: UncheckedAccount<'info>,
    pub compression_program: Program<'info, spl_account_compression::program::SplAccountCompression>,
    /// CHECK:
    #[account(address = NOOP_PROGRAM)]
    pub noop_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CheckConsensus<'info> {
    #[account(mut, has_one = config @ MiniNcnError::ConfigMismatch)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(has_one = authority @ MiniNcnError::InvalidAuthority)]
    pub config: Account<'info, Config>,
    /// CHECK:
    #[account(seeds = [b"vault", config.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub vault: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(address = voter_state.config @ MiniNcnError::ConfigMismatch)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"ballot_box", config.key().as_ref()], bump)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(mut, seeds = [b"voter_state", config.key().as_ref(), operator.key().as_ref()], bump)]
    pub voter_state: Account<'info, VoterState>,
    /// CHECK:
    #[account(seeds = [b"vault", config.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub vault: UncheckedAccount<'info>,
    pub operator_admin: Signer<'info>,
    /// CHECK:
    #[account(address = voter_state.operator @ MiniNcnError::InvalidOperator)]
    pub operator: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ClaimRewardsArgs {
    pub index: u32,
    pub total_rewards: u64,
    pub proof: Vec<[u8; 32]>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub ncn: Pubkey,
    pub authority: Pubkey,
}

// TODO: use real data structure
#[account]
#[derive(InitSpace)]
pub struct BallotBox {
    pub config: Pubkey,
    pub epoch: u64,
    pub operators_voted: u64,
    pub approved_votes: u64,
    pub merkle_tree: Pubkey,
    pub rewards_root: [u8; 32],
    pub proposed_rewards_root: Option<[u8; 32]>,
}

impl BallotBox {
    pub fn propose(&mut self, epoch: u64, proposed_rewards_root: [u8; 32]) {
        self.epoch = epoch;
        self.operators_voted = 0;
        self.approved_votes = 0;
        self.proposed_rewards_root = Some(proposed_rewards_root);
    }
}

#[account]
#[derive(InitSpace)]
pub struct VoterState {
    pub config: Pubkey,
    pub operator: Pubkey,
    // TODO: use those to validate
    // pub operator_vault_ticket: Pubkey,
    // pub vault_operator_delegation: Pubkey,
    pub last_voted_epoch: u64,
    pub claimed_rewards: u64,
}


#[error_code]
pub enum MiniNcnError {
    #[msg("Config mismatch")]
    ConfigMismatch,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid vault")]
    InvalidVault,
    #[msg("Invalid operator")]
    InvalidOperator,
    #[msg("Invalid operator vault ticket")]
    InvalidOperatorVaultTicket,
    #[msg("Invalid vault operator delegation")]
    InvalidVaultOperatorDelegation,
    #[msg("Invalid epoch")]
    InvalidEpoch,
    #[msg("Proposed rewards root already exists")]
    NonEmptyProposedRoot,
    #[msg("No proposed rewards root")]
    EmptyProposedRoot,
    #[msg("Invalid proof")]
    InvalidProof,
}
