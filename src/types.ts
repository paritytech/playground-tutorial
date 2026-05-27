export type Move = "X" | "O";

export type Cell = Move | null;

export type RoundResult = "win" | "loss" | "draw";

export interface Round {
    result: RoundResult;
    board: Cell[];
}

export interface GameData {
    id: number;
    rounds: Round[];
    result: RoundResult;
    pointsChange: number;
    timestamp: number;
}

export interface PlayerData {
    player: string;
    totalGames: number;
    wins: number;
    losses: number;
    draws: number;
    points: number;
    games: GameData[];
}
