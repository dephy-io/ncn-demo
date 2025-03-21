#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use jito_restaking_client::programs::JITO_RESTAKING_ID;
use jito_vault_client::programs::JITO_VAULT_ID;

declare_id!("FMtP7JSgYneYu36nisXubFWTWw6LGC9EFJ6YhjAq6CQr");

const MAX_OPERATORS: u64 = 3;
const VOTE_WINDOW: u64 = 10;

#[program]
pub mod mini_ncn {
    use jito_restaking_client::accounts::{Operator, OperatorVaultTicket};
    use jito_vault_client::accounts::{Vault, VaultOperatorDelegation};

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.ncn = ctx.accounts.ncn.key();
        config.authority = ctx.accounts.authority.key();

        let ballot_box = &mut ctx.accounts.ballot_box;
        ballot_box.config = config.key();

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
            &[b"mini_ncn", ctx.accounts.ncn.key().as_ref(), &[ctx.bumps.config]],
            &[b"vrt_mint", ctx.accounts.st_mint.key().as_ref(), &[ctx.bumps.vrt_mint]],
        ])?;

        Ok(())
    }

    pub fn propose(ctx: Context<Propose>, state: [u8; 32]) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;
        let clock = Clock::get()?;

        require!(ballot_box.state.is_none(), MiniNcnError::NonEmptyState);

        // TODO: maybe set consensus threshold here
        ballot_box.reset(clock.slot, state);

        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, approved: bool) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;

        let clock = Clock::get()?;
        require!(
            clock.slot <= ballot_box.slot + VOTE_WINDOW,
            MiniNcnError::InvalidSlot
        );

        let operator_index = ballot_box.operators_voted;
        require!(
            operator_index < MAX_OPERATORS,
            MiniNcnError::InvalidOperator
        );

        // TODO: ncn operator ticket stuff

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

        // skip check duplicated voter for demo
        ballot_box.operators[operator_index as usize] = ctx.accounts.operator_admin.key();
        ballot_box.operators_voted += 1;
        if approved {
            ballot_box.approved_votes += vault_operator_delegation.delegation_state.staked_amount;
            msg!(
                "{} Approved at epoch {}",
                ctx.accounts.operator_admin.key(),
                clock.epoch
            );
        }

        Ok(())
    }

    pub fn check_consensus(ctx: Context<CheckConsensus>) -> Result<()> {
        let ballot_box = &mut ctx.accounts.ballot_box;

        require!(ballot_box.state.is_some(), MiniNcnError::EmptyState);

        let vault = Vault::from_bytes(&ctx.accounts.vault.try_borrow_data()?)?;

        let clock = Clock::get()?;
        let vote_window_passed = clock.slot > ballot_box.slot + VOTE_WINDOW;
        let mut consensus_reached = false;

        // TODO: 
        if ballot_box.approved_votes > vault.vrt_supply / 2 {
            consensus_reached = true;
        } else {
            if vote_window_passed && ballot_box.approved_votes > vault.vrt_supply / 2 {
                consensus_reached = true;
            }
        }

        if consensus_reached {
            msg!("Consensus reached");

            // TODO: distribute rewards
        }

        if vote_window_passed || consensus_reached {
            ballot_box.state = None;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
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
    pub ncn: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// CHECK:
    pub ncn: UncheckedAccount<'info>,
    #[account(seeds = [b"mini_ncn", ncn.key().as_ref()], bump)]
    pub config: Account<'info, Config>,
    /// CHECK:
    #[account(address = JITO_VAULT_ID)]
    pub jito_vault_program: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut, seeds = [b"config"], bump, seeds::program = JITO_VAULT_ID)]
    pub jito_vault_config: UncheckedAccount<'info>,
    /// CHECK:
    #[account(mut, seeds = [b"vault", config.key().as_ref()], bump, seeds::program = JITO_VAULT_ID)]
    pub vault: UncheckedAccount<'info>,
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
pub struct Propose<'info> {
    #[account(mut, has_one = config @ MiniNcnError::ConfigMismatch)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(has_one = authority @ MiniNcnError::InvalidAuthority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub ballot_box: Account<'info, BallotBox>,
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
}

#[derive(Accounts)]
pub struct CheckConsensus<'info> {
    #[account(mut, has_one = config @ MiniNcnError::ConfigMismatch)]
    pub ballot_box: Account<'info, BallotBox>,
    #[account(has_one = authority @ MiniNcnError::InvalidAuthority)]
    pub config: Account<'info, Config>,
    /// CHECK:
    #[account()]
    pub vault: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
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
    // TODO: use epoch in real program
    pub slot: u64,
    pub operators_voted: u64,
    pub approved_votes: u64,
    pub operators: [Pubkey; MAX_OPERATORS as usize],
    pub state: Option<[u8; 32]>,
}

impl BallotBox {
    pub fn reset(&mut self, slot: u64, state: [u8; 32]) {
        self.slot = slot;
        self.operators_voted = 0;
        self.approved_votes = 0;
        self.operators = [Pubkey::default(), Pubkey::default(), Pubkey::default()];
        self.state = Some(state);
    }
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
    #[msg("Invalid slot")]
    InvalidSlot,
    #[msg("Non-empty state")]
    NonEmptyState,
    #[msg("No state")]
    EmptyState,
}
