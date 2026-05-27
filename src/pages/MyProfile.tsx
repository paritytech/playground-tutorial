import { useState, useEffect } from "react";
import type { SignerAccount } from "@polkadot-apps/signer";
import {
    asBytes20, cidKey, fetchFromGateway, getLeaderboard, loadPlayerData,
    PRIMARY_GATEWAY, short,
} from "../utils.ts";
import type { PlayerData } from "../types.ts";

type Source = "local" | "bulletin" | "chain";

export default function MyProfile({ account, refreshKey }: {
    account: SignerAccount;
    onLeaderboard?: () => void;
    refreshKey?: number;
}) {
    const [data, setData] = useState<PlayerData | null>(null);
    const [source, setSource] = useState<Source>("local");
    const [cid, setCid] = useState<string | null>(null);
    const [chainPoints, setChainPoints] = useState<number | null>(null);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        // 1) Start from local data — instant render.
        const local = loadPlayerData(account.address);
        setData(local);
        setSource("local");

        // 2) Fetch contract state: points + CID pointer. The contract is the
        //    canonical leaderboard — Bulletin holds the round-level JSON.
        let cancelled = false;
        (async () => {
            try {
                const lb = await getLeaderboard();
                const h160 = asBytes20(account);
                const [pointsRes, cidRes] = await Promise.all([
                    lb.getPlayerPoints.query(h160),
                    lb.getPlayerCid.query(h160),
                ]);
                if (cancelled) return;
                if (pointsRes.success) {
                    setChainPoints(Number(pointsRes.value as bigint));
                }
                if (cidRes.success) {
                    const chainCid = cidRes.value as string;
                    if (chainCid) {
                        setCid(chainCid);
                        setSource("chain");
                        // 3) Resolve game-level data from Bulletin using the on-chain CID.
                        try {
                            const bytes = await fetchFromGateway(chainCid);
                            if (cancelled) return;
                            const parsed = JSON.parse(new TextDecoder().decode(bytes)) as PlayerData;
                            setData(parsed);
                        } catch { /* keep local data */ }
                        return;
                    }
                }
                // No on-chain CID → try the locally-cached CID pointer.
                const stored = localStorage.getItem(cidKey(account.address));
                if (stored) {
                    setCid(stored);
                    try {
                        const bytes = await fetchFromGateway(stored);
                        if (cancelled) return;
                        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as PlayerData;
                        setData(parsed);
                        setSource("bulletin");
                    } catch { /* keep local */ }
                }
            } catch { /* keep local data, contract unreachable */ }
        })();

        return () => { cancelled = true; };
    }, [account.address, refreshKey]);

    if (!data || data.totalGames === 0) {
        return (
            <div className="profile-card">
                <div className="profile-header">
                    <div className="profile-address">{short(account.address)}</div>
                </div>
                <div className="profile-empty">No games yet — play your first match!</div>
            </div>
        );
    }

    const winRate = data.totalGames > 0 ? Math.round((data.wins / data.totalGames) * 100) : 0;
    const displayPoints = chainPoints !== null ? chainPoints : data.points;

    return (
        <div className="profile-card">
            <div className="profile-header" onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
                <div>
                    <div className="profile-address">{short(account.address)}</div>
                    <div className="profile-points">
                        {displayPoints > 0 ? `+${displayPoints}` : displayPoints} pts
                    </div>
                </div>
                <div className="profile-stats-mini">
                    <span className="profile-stat-win">{data.wins}W</span>
                    <span className="profile-stat-loss">{data.losses}L</span>
                    <span className="profile-stat-draw">{data.draws}D</span>
                    <span className="profile-stat-rate">{winRate}%</span>
                    <span className="profile-expand">{expanded ? "▲" : "▼"}</span>
                </div>
            </div>

            <div className={`profile-source ${source}`}>
                {source === "chain" ? (
                    <>
                        <span className="profile-source-dot" />
                        <span>On contract ✦</span>
                        {cid && (
                            <a
                                className="profile-source-cid"
                                href={`${PRIMARY_GATEWAY}${cid}`}
                                target="_blank"
                                rel="noreferrer"
                                title={cid}
                                onClick={e => e.stopPropagation()}
                            >
                                {short(cid)}
                            </a>
                        )}
                    </>
                ) : source === "bulletin" && cid ? (
                    <>
                        <span className="profile-source-dot" />
                        <span>On Bulletin ✦</span>
                        <a
                            className="profile-source-cid"
                            href={`${PRIMARY_GATEWAY}${cid}`}
                            target="_blank"
                            rel="noreferrer"
                            title={cid}
                            onClick={e => e.stopPropagation()}
                        >
                            {short(cid)}
                        </a>
                    </>
                ) : (
                    <>
                        <span className="profile-source-dot local" />
                        <span>Local only — checking contract...</span>
                    </>
                )}
            </div>

            {expanded && (
                <div className="profile-games">
                    {data.games.slice().reverse().slice(0, 10).map(game => (
                        <div key={game.id} className="profile-game-row">
                            <span className="profile-game-mode">vs CPU</span>
                            <span className="profile-game-rounds">
                                {game.rounds.map((r, i) => (
                                    <span key={i} className={`round-pip ${r.result}`} title={r.result}>
                                        {r.result === "win" ? "W" : r.result === "loss" ? "L" : "D"}
                                    </span>
                                ))}
                            </span>
                            <span className={`profile-game-result ${game.result}`}>
                                {game.result === "win" ? "W" : game.result === "loss" ? "L" : "D"}
                            </span>
                            <span className="profile-game-pts">
                                {game.pointsChange > 0 ? `+${game.pointsChange}` : game.pointsChange}
                            </span>
                        </div>
                    ))}
                    {data.games.length > 10 && (
                        <div className="profile-more">...and {data.games.length - 10} more</div>
                    )}
                </div>
            )}
        </div>
    );
}
