import { useState, useEffect } from "react";
import type { SignerAccount } from "@polkadot-apps/signer";
import type { Cell, Move, Round, RoundResult } from "../types.ts";
import {
    appendGame, asBytes20, boardWinner, cidKey, emptyBoard,
    ensureMapped, getLeaderboard, loadPlayerData, pointsForResult,
    PRIMARY_GATEWAY, randomEmptyCell, roundResultFromWinner,
    setContractAccount, short, uploadToBulletin, winningLine,
} from "../utils.ts";

const PLAYER: Move = "X";
const CPU: Move = "O";
const BEST_OF = 3;
const NEEDED = Math.ceil(BEST_OF / 2);

const RESULT_TEXT: Record<RoundResult, string> = {
    win: "Round won!",
    loss: "Round lost!",
    draw: "Round draw!",
};

const MATCH_TEXT: Record<RoundResult, string> = {
    win: "You won the match!",
    loss: "You lost the match!",
    draw: "Match drawn!",
};

export default function SoloGame({ account, onDone }: {
    account: SignerAccount;
    onDone: () => void;
}) {
    const [rounds, setRounds] = useState<Round[]>([]);
    const [board, setBoard] = useState<Cell[]>(emptyBoard);
    const [playerTurn, setPlayerTurn] = useState(true);
    const [roundOver, setRoundOver] = useState<RoundResult | null>(null);
    const [matchOver, setMatchOver] = useState(false);
    const [saved, setSaved] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "uploaded" | "failed">("idle");
    const [cid, setCid] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [chainStatus, setChainStatus] = useState<"idle" | "writing" | "written" | "failed">("idle");
    const [chainError, setChainError] = useState<string | null>(null);

    const playerWins = rounds.filter(r => r.result === "win").length;
    const cpuWins = rounds.filter(r => r.result === "loss").length;
    const roundNumber = rounds.length + 1;
    const winLine = winningLine(board);

    const overallResult: RoundResult =
        playerWins > cpuWins ? "win" : cpuWins > playerWins ? "loss" : "draw";
    const finalPts = pointsForResult(overallResult);

    // CPU plays after the player.
    useEffect(() => {
        if (playerTurn || roundOver || matchOver) return;
        const timer = setTimeout(() => {
            setBoard(prev => {
                if (boardWinner(prev) !== null) return prev;
                const idx = randomEmptyCell(prev);
                if (idx === undefined) return prev;
                const next = prev.slice();
                next[idx] = CPU;
                return next;
            });
            setPlayerTurn(true);
        }, 600);
        return () => clearTimeout(timer);
    }, [playerTurn, roundOver, matchOver]);

    // Check for round end.
    useEffect(() => {
        if (roundOver) return;
        const w = boardWinner(board);
        if (w === null) return;
        const result = roundResultFromWinner(w, PLAYER);
        setRoundOver(result);

        const newRounds = [...rounds, { result, board: board.slice() }];
        setTimeout(() => {
            setRounds(newRounds);
            const pw = newRounds.filter(r => r.result === "win").length;
            const cw = newRounds.filter(r => r.result === "loss").length;

            if (pw >= NEEDED || cw >= NEEDED || newRounds.length >= BEST_OF) {
                const final: RoundResult = pw > cw ? "win" : cw > pw ? "loss" : "draw";
                appendGame(account.address, {
                    rounds: newRounds,
                    result: final,
                    pointsChange: pointsForResult(final),
                    timestamp: Math.floor(Date.now() / 1000),
                });
                setSaved(true);
                setMatchOver(true);

                // Upload full history to Bulletin, then write CID + points delta to the
                // on-chain leaderboard. Bulletin upload must succeed first because the
                // contract only stores the CID pointer (the JSON itself stays off-chain).
                setUploadStatus("uploading");
                const fullData = loadPlayerData(account.address);
                const bytes = new TextEncoder().encode(JSON.stringify(fullData));
                const matchPts = pointsForResult(final);
                (async () => {
                    let newCid: string;
                    try {
                        newCid = await uploadToBulletin(bytes);
                    } catch (err: any) {
                        setUploadError(err?.message ?? String(err));
                        setUploadStatus("failed");
                        return;
                    }
                    localStorage.setItem(cidKey(account.address), newCid);
                    setCid(newCid);
                    setUploadStatus("uploaded");

                    setChainStatus("writing");
                    try {
                        const signer = account.getSigner();
                        await ensureMapped(account.address, signer);
                        await setContractAccount(account.address, signer);
                        const lb = await getLeaderboard();
                        await lb.updateResult.tx(asBytes20(account), newCid, BigInt(matchPts));
                        setChainStatus("written");
                    } catch (err: any) {
                        setChainError(err?.message ?? String(err));
                        setChainStatus("failed");
                    }
                })();
            }
        }, 1200);
    }, [board, roundOver, rounds, account.address]);

    const pickCell = (i: number) => {
        if (!playerTurn || roundOver || matchOver) return;
        if (board[i] !== null) return;
        const next = board.slice();
        next[i] = PLAYER;
        setBoard(next);
        setPlayerTurn(false);
    };

    const nextRound = () => {
        setBoard(emptyBoard());
        setRoundOver(null);
        setPlayerTurn(true);
    };

    return (
        <div className="game-page">
            <h2>Solo — Best of {BEST_OF}</h2>

            <div className="score-display">
                <div>You (X): <span>{playerWins}</span></div>
                <div>Round <span>{Math.min(roundNumber, BEST_OF)}</span>/{BEST_OF}</div>
                <div>CPU (O): <span>{cpuWins}</span></div>
            </div>

            <div className="ttt-board">
                {board.map((cell, i) => {
                    const inWin = winLine && winLine.includes(i as 0 | 1 | 2);
                    const cls = [
                        "ttt-cell",
                        cell === "X" ? "x" : cell === "O" ? "o" : "",
                        cell ? "filled" : "",
                        inWin ? "win" : "",
                    ].filter(Boolean).join(" ");
                    return (
                        <button
                            key={i}
                            className={cls}
                            onClick={() => pickCell(i)}
                            disabled={!playerTurn || !!roundOver || matchOver || cell !== null}
                            aria-label={`cell ${i + 1}`}
                        >
                            {cell ?? ""}
                        </button>
                    );
                })}
            </div>

            <div className="turn-indicator">
                {matchOver
                    ? " "
                    : roundOver
                        ? RESULT_TEXT[roundOver]
                        : playerTurn ? "Your turn" : "CPU thinking..."}
            </div>

            {roundOver && !matchOver && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
                    <button className="btn btn-primary" onClick={nextRound}>
                        Next round &rarr;
                    </button>
                </div>
            )}

            {matchOver && (
                <div className="round-result">
                    <div className={`round-result-text ${overallResult}`} style={{ fontSize: 24, marginBottom: 8 }}>
                        {MATCH_TEXT[overallResult]}
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 16 }}>
                        {playerWins} &mdash; {cpuWins} ({finalPts > 0 ? `+${finalPts}` : finalPts} pts)
                    </div>

                    <div className="history-card-rounds" style={{ justifyContent: "center", marginBottom: 16 }}>
                        {rounds.map((r, i) => (
                            <span key={i} className={`round-badge ${r.result}`}>
                                {r.result === "win" ? "W" : r.result === "loss" ? "L" : "D"}
                            </span>
                        ))}
                    </div>

                    {saved && <div className="status" style={{ color: "var(--success)" }}>Saved locally</div>}

                    {uploadStatus === "uploading" && (
                        <div className="status">Uploading to Bulletin Chain...</div>
                    )}
                    {uploadStatus === "uploaded" && cid && (
                        <div className="bulletin-card">
                            <div className="bulletin-label">Saved on-chain ✦</div>
                            <a
                                className="bulletin-cid"
                                href={`${PRIMARY_GATEWAY}${cid}`}
                                target="_blank"
                                rel="noreferrer"
                                title={cid}
                            >
                                {short(cid)}
                            </a>
                        </div>
                    )}
                    {uploadStatus === "failed" && (
                        <div className="status" style={{ color: "var(--danger)" }}>
                            Bulletin upload failed: {uploadError ?? "unknown"}
                        </div>
                    )}

                    {chainStatus === "writing" && (
                        <div className="status">Writing to leaderboard contract...</div>
                    )}
                    {chainStatus === "written" && (
                        <div className="status" style={{ color: "var(--success)" }}>
                            Leaderboard updated on-chain ✦
                        </div>
                    )}
                    {chainStatus === "failed" && (
                        <div className="status" style={{ color: "var(--danger)" }}>
                            Contract write failed: {chainError ?? "unknown"}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button className="btn btn-primary" onClick={onDone}>
                            Home
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
