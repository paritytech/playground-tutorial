import { useState, useEffect } from "react";
import { SignerManager, type SignerState } from "@polkadot-apps/signer";
import { preimageManager, requestPermission } from "@novasamatech/product-sdk";
import { blake2b } from "@noble/hashes/blake2.js";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";
import type { Cell, Move, RoundResult, PlayerData, GameData } from "./types.ts";

// ---------------------------------------------------------------------------
// Signer Manager (Host API)
// ---------------------------------------------------------------------------

export const signerManager = new SignerManager({ dappName: "cosmic-ttt" });

export function useSignerState(): SignerState {
    const [state, setState] = useState<SignerState>(signerManager.getState());
    useEffect(() => signerManager.subscribe(setState), []);
    return state;
}

// ---------------------------------------------------------------------------
// Game helpers (Tic-Tac-Toe)
// ---------------------------------------------------------------------------

export const short = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);

export const WINNING_LINES: readonly (readonly [number, number, number])[] = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

export function emptyBoard(): Cell[] {
    return Array(9).fill(null);
}

export function winningLine(board: Cell[]): readonly [number, number, number] | null {
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
    }
    return null;
}

export function boardWinner(board: Cell[]): Move | "draw" | null {
    const line = winningLine(board);
    if (line) return board[line[0]]!;
    if (board.every(c => c !== null)) return "draw";
    return null;
}

export function roundResultFromWinner(winner: Move | "draw", playerSymbol: Move = "X"): RoundResult {
    if (winner === "draw") return "draw";
    return winner === playerSymbol ? "win" : "loss";
}

export function randomEmptyCell(board: Cell[]): number {
    const empties: number[] = [];
    for (let i = 0; i < board.length; i++) if (board[i] === null) empties.push(i);
    return empties[Math.floor(Math.random() * empties.length)];
}

export function pointsForResult(result: RoundResult): number {
    if (result === "win") return 2;
    if (result === "loss") return -1;
    return 0;
}

// ---------------------------------------------------------------------------
// LocalStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "cosmic-ttt:";
const CID_PREFIX = "cosmic-ttt-cid:";

export const cidKey = (addr: string) => CID_PREFIX + addr;

export function loadPlayerData(address: string): PlayerData {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + address);
        if (raw) return JSON.parse(raw);
    } catch { /* fall through */ }
    return {
        player: address,
        totalGames: 0, wins: 0, losses: 0, draws: 0, points: 0,
        games: [],
    };
}

export function savePlayerData(data: PlayerData) {
    localStorage.setItem(STORAGE_PREFIX + data.player, JSON.stringify(data));
}

export function appendGame(address: string, game: Omit<GameData, "id">): PlayerData {
    const data = loadPlayerData(address);
    const fullGame: GameData = { ...game, id: data.games.length + 1 };
    data.games.push(fullGame);
    data.totalGames++;
    if (game.result === "win") data.wins++;
    else if (game.result === "loss") data.losses++;
    else data.draws++;
    data.points += game.pointsChange;
    savePlayerData(data);
    return data;
}

// ---------------------------------------------------------------------------
// Bulletin Chain (decentralised storage via host preimage manager)
// ---------------------------------------------------------------------------

const BLAKE2B_256_CODE = 0xb220;
const _grantedPermissions = new Set<string>();

/** Bulletin uses CIDv1 raw codec wrapping a blake2b-256 multihash. */
export function calculateCID(bytes: Uint8Array): string {
    const hash = blake2b(bytes, { dkLen: 32 });
    const digest = createDigest(BLAKE2B_256_CODE, hash);
    return CID.createV1(raw.code, digest).toString();
}

async function ensurePreimagePermission(): Promise<void> {
    const tag = "PreimageSubmit";
    if (_grantedPermissions.has(tag)) return;
    const result = await requestPermission({ tag, value: undefined });
    if (result.isErr()) throw new Error(`Permission error: ${result.error.message}`);
    if (!result.value) throw new Error(`${tag} permission denied`);
    _grantedPermissions.add(tag);
}

/** Upload bytes to Bulletin via the host. Returns the CIDv1 string. */
export async function uploadToBulletin(bytes: Uint8Array): Promise<string> {
    await ensurePreimagePermission();
    const cid = calculateCID(bytes);
    await preimageManager.submit(bytes);
    return cid;
}

const GATEWAYS: readonly string[] = [
    "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://nftstorage.link/ipfs/",
];

export const PRIMARY_GATEWAY = GATEWAYS[0];

/** Race all gateways — first responder wins. Throws if none succeed. */
export async function fetchFromGateway(cid: string): Promise<Uint8Array> {
    const attempts = GATEWAYS.map(async base => {
        const res = await fetch(base + cid);
        if (!res.ok) throw new Error(`${base} -> ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    });
    return Promise.any(attempts);
}

// ---------------------------------------------------------------------------
// Leaderboard contract (Paseo Asset Hub Next via pallet-revive)
// ---------------------------------------------------------------------------

import {
    ContractManager, createContractRuntimeFromClient, ensureContractAccountMapped,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { createClient, type PolkadotClient } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";
import cdmJson from "../cdm.json";

const ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";
const TARGET_HASH = "929b5c63e2cb5202";
export const LEADERBOARD_PKG = "@cosmic-xo/leaderboard";

let _client: PolkadotClient | null = null;
let _manager: ContractManager | null = null;
let _initPromise: Promise<{ client: PolkadotClient; manager: ContractManager }> | null = null;
const _mappedAccounts = new Set<string>();

async function initContracts() {
    if (_client && _manager) return { client: _client, manager: _manager };
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const client = createClient(getWsProvider(ASSET_HUB_WS));
        // Wake chain follow before any storage/contract query.
        await client.getChainSpecData();
        await client.getBestBlocks();

        const manager = ContractManager.fromClient(cdmJson, client, paseo_asset_hub, {
            targetHash: TARGET_HASH,
        });
        _client = client;
        _manager = manager;
        return { client, manager };
    })();
    return _initPromise;
}

/** Returns the leaderboard contract handle. Lazily initialises the chain client. */
export async function getLeaderboard() {
    const { manager } = await initContracts();
    return manager.getContract(LEADERBOARD_PKG);
}

/** Set the signer + origin for subsequent contract txs. Call when selected account changes. */
export async function setContractAccount(address: string, signer: any) {
    const { manager } = await initContracts();
    manager.setDefaults({ origin: address, signer });
}

/** Map the SS58 account to its H160 on pallet-revive. Required once per account. */
export async function ensureMapped(address: string, signer: any) {
    if (_mappedAccounts.has(address)) return;
    const { manager } = await initContracts();
    await ensureContractAccountMapped(manager.getRuntime(), address, signer);
    _mappedAccounts.add(address);
}

/** Normalise an h160 address to a `0x...` 20-byte hex string for ABI calls. */
export function asBytes20(h160OrAccount: string | { h160Address: string }): `0x${string}` {
    const hex = typeof h160OrAccount === "string" ? h160OrAccount : h160OrAccount.h160Address;
    return (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`;
}
