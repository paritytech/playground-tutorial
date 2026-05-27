#![no_main]
#![no_std]

use alloc::string::String;
use pvm::storage::Mapping;
use pvm_contract as pvm;

#[pvm::storage]
struct Storage {
    player_count: u64,
    player_at: Mapping<u64, [u8; 20]>,
    is_registered: Mapping<[u8; 20], bool>,
    player_cid: Mapping<[u8; 20], String>,
    player_points: Mapping<[u8; 20], i64>,
}

#[pvm::contract(cdm = "@cosmic-xo/leaderboard")]
mod leaderboard {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::player_count().set(&0);
        Ok(())
    }

    /// Register a player by H160 address. Returns the player's index.
    /// Idempotent: re-registering returns the existing index.
    #[pvm::method]
    pub fn register(player: [u8; 20]) -> u64 {
        if Storage::is_registered().get(&player).unwrap_or(false) {
            return current_index(&player);
        }
        let idx = Storage::player_count().get().unwrap_or(0);
        Storage::player_at().insert(&idx, &player);
        Storage::is_registered().insert(&player, &true);
        Storage::player_points().insert(&player, &0);
        Storage::player_count().set(&(idx + 1));
        idx
    }

    /// Update a player's Bulletin CID pointer and adjust points by `points_delta`.
    /// Auto-registers the player on first call.
    #[pvm::method]
    pub fn update_result(player: [u8; 20], new_cid: String, points_delta: i64) {
        if !Storage::is_registered().get(&player).unwrap_or(false) {
            let idx = Storage::player_count().get().unwrap_or(0);
            Storage::player_at().insert(&idx, &player);
            Storage::is_registered().insert(&player, &true);
            Storage::player_points().insert(&player, &0);
            Storage::player_count().set(&(idx + 1));
        }
        Storage::player_cid().insert(&player, &new_cid);
        let prev = Storage::player_points().get(&player).unwrap_or(0);
        Storage::player_points().insert(&player, &(prev + points_delta));
    }

    #[pvm::method]
    pub fn get_player_count() -> u64 {
        Storage::player_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_player_at(index: u64) -> [u8; 20] {
        Storage::player_at().get(&index).unwrap_or([0u8; 20])
    }

    #[pvm::method]
    pub fn get_player_cid(player: [u8; 20]) -> String {
        Storage::player_cid().get(&player).unwrap_or_default()
    }

    #[pvm::method]
    pub fn get_player_points(player: [u8; 20]) -> i64 {
        Storage::player_points().get(&player).unwrap_or(0)
    }

    #[pvm::method]
    pub fn is_registered(player: [u8; 20]) -> bool {
        Storage::is_registered().get(&player).unwrap_or(false)
    }

    fn current_index(player: &[u8; 20]) -> u64 {
        let count = Storage::player_count().get().unwrap_or(0);
        let mut i = 0u64;
        while i < count {
            if Storage::player_at().get(&i).as_ref() == Some(player) {
                return i;
            }
            i += 1;
        }
        0
    }
}
