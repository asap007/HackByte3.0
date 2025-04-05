module your_deployer_address::compute_credit {
    use std::signer;
    use std::string::{String};
    use aptos_framework::coin::{Self, Coin, BurnCapability, MintCapability};
    use aptos_framework::account;
    use aptos_framework::event;
    use aptos_framework::aptos_coin::AptosCoin; // Using APT directly

    // === Errors ===
    const E_INSUFFICIENT_BALANCE: u64 = 1;
    const E_NOT_AUTHORIZED: u64 = 2;
    const E_ALREADY_REGISTERED: u64 = 3;
    const E_CREDIT_STORE_NOT_PUBLISHED: u64 = 4;
    const E_ZERO_AMOUNT: u64 = 5;

    // === Structs ===

    // Resource stored under each user's account holding their credits
    struct CreditStore has key {
        credits: Coin<AptosCoin>,
        // Optional: Could add tracking for pending jobs, etc.
    }

    // Resource stored under the deployer account to manage the platform
    struct PlatformConfig has key {
        // The address authorized to trigger payments (your backend's account)
        payment_processor_address: address,
        // Optional: Minimum deposit, fees, etc.
    }

    // === Events ===
    struct DepositEvent has drop, store {
        user: address,
        amount: u64,
    }

    struct WithdrawalEvent has drop, store {
        user: address,
        amount: u64,
    }

    struct PaymentProcessedEvent has drop, store {
        user: address,
        provider: address,
        amount: u64,
        job_id: String, // Optional: track which job was paid for
    }

    // === Public Functions ===

    // Called once by the contract deployer to set up the platform config
    public entry fun initialize_platform(deployer: &signer, payment_processor: address) {
        // Ensure only called once by deployer
        assert!(!exists<PlatformConfig>(signer::address_of(deployer)), E_ALREADY_REGISTERED);
        move_to(deployer, PlatformConfig {
            payment_processor_address: payment_processor,
        });
    }

    // Called by users to create their credit store (can be combined with deposit)
    // Or called implicitly by deposit if not exists
    fun ensure_credit_store_exists(user: &signer) {
        let user_addr = signer::address_of(user);
        if (!exists<CreditStore>(user_addr)) {
            move_to(user, CreditStore {
                credits: coin::zero<AptosCoin>(),
            });
            // Register the account for AptosCoin if not already done
            if (!coin::is_account_registered<AptosCoin>(user_addr)) {
                account::register_coin<AptosCoin>(user); // User pays gas for this registration
            }
        }
    }


    // Called by the user to deposit APT into their credit balance
    public entry fun deposit(user: &signer, amount: u64) acquires CreditStore {
        assert!(amount > 0, E_ZERO_AMOUNT);
        ensure_credit_store_exists(user); // Make sure store exists

        let user_addr = signer::address_of(user);
        let credit_store = borrow_global_mut<CreditStore>(user_addr);

        // Withdraw from user's main AptosCoin balance and deposit into the store's coin
        let coins_to_deposit = coin::withdraw<AptosCoin>(user, amount);
        coin::deposit(user_addr, &mut credit_store.credits, coins_to_deposit); // Deposit into the *resource's* coin store

        event::emit(DepositEvent {
            user: user_addr,
            amount,
        });
    }

    // Called by the user to withdraw APT from their credit balance
    public entry fun withdraw(user: &signer, amount: u64) acquires CreditStore {
        assert!(amount > 0, E_ZERO_AMOUNT);
        let user_addr = signer::address_of(user);
        assert!(exists<CreditStore>(user_addr), E_CREDIT_STORE_NOT_PUBLISHED);

        let credit_store = borrow_global_mut<CreditStore>(user_addr);

        // Check if sufficient credits are available in the store
        assert!(coin::value(&credit_store.credits) >= amount, E_INSUFFICIENT_BALANCE);

        // Withdraw from the store's coin and deposit back to the user's main AptosCoin balance
        let coins_to_withdraw = coin::withdraw(&mut credit_store.credits, amount, signer::address_of(user)); // Use resource address for withdrawal capability
        coin::deposit(user_addr, coins_to_withdraw);

         event::emit(WithdrawalEvent {
            user: user_addr,
            amount,
        });
    }

    // *** Called by your BACKEND SERVICE (Payment Processor) ***
    public entry fun process_payment(
        processor: &signer, // Your backend service's signer
        user_addr: address,
        provider_addr: address,
        amount: u64,
        job_id: String // Optional tracking
    ) acquires CreditStore, PlatformConfig {
        assert!(amount > 0, E_ZERO_AMOUNT);
        // 1. Authorize the caller (check if it's the registered backend service)
        let platform_config = borrow_global<PlatformConfig>(@your_deployer_address); // Read deployer's config
        assert!(signer::address_of(processor) == platform_config.payment_processor_address, E_NOT_AUTHORIZED);

        // 2. Check if user has a credit store and sufficient balance
        assert!(exists<CreditStore>(user_addr), E_CREDIT_STORE_NOT_PUBLISHED);
        let credit_store = borrow_global_mut<CreditStore>(user_addr);
        assert!(coin::value(&credit_store.credits) >= amount, E_INSUFFICIENT_BALANCE);

        // 3. Deduct from user's credit balance and transfer to provider
        // Withdraw from the user's credit store (within the contract)
        let payment_coins = coin::withdraw(&mut credit_store.credits, amount, user_addr); // Use user's address for capability reference

        // Ensure provider account can receive APT
        // This might fail if the provider account doesn't exist or hasn't registered for AptosCoin
        // Consider adding registration logic or requiring providers to be pre-registered.
         if (!coin::is_account_registered<AptosCoin>(provider_addr)) {
             // Option 1: Fail the transaction
             // Option 2: Try to register them (requires provider to have min balance, complex)
             // Best: Assume provider is registered. Or handle registration off-chain.
              abort(E_NOT_AUTHORIZED) // Placeholder error, use a specific one
         }

        // Deposit the withdrawn coins into the provider's account
        coin::deposit(provider_addr, payment_coins);

        // 4. Emit event
        event::emit(PaymentProcessedEvent {
            user: user_addr,
            provider: provider_addr,
            amount,
            job_id,
        });
    }

    // === View Functions ===

    // Get the current credit balance for a user
    #[view]
    public fun get_credit_balance(user_addr: address): u64 acquires CreditStore {
        if (!exists<CreditStore>(user_addr)) {
            0
        } else {
            let credit_store = borrow_global<CreditStore>(user_addr);
            coin::value(&credit_store.credits)
        }
    }

     #[view]
    public fun get_payment_processor(deployer_addr: address): address acquires PlatformConfig {
         borrow_global<PlatformConfig>(deployer_addr).payment_processor_address
    }
}