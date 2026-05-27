import { useState, useEffect } from "react";
import { asBytes20, getLeaderboard, short } from "../utils.ts";

type Row = {
    h160: string;
    points: number;
};

export default function Leaderboard({ selfH160 }: { selfH160?: string }) {
    const [rows, setRows] = useState<Row[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const lb = await getLeaderboard();
                const countRes = await lb.getPlayerCount.query();
                if (!countRes.success) throw new Error("getPlayerCount failed");
                const count = Number(countRes.value as bigint);

                const indices = Array.from({ length: count }, (_, i) => BigInt(i));
                const addrResults = await Promise.all(
                    indices.map(i => lb.getPlayerAt.query(i)),
                );
                const addrs: string[] = addrResults
                    .filter(r => r.success)
                    .map(r => (r.value as string).toLowerCase());

                const pointsResults = await Promise.all(
                    addrs.map(a => lb.getPlayerPoints.query(asBytes20(a))),
                );
                if (cancelled) return;

                const result: Row[] = addrs.map((h160, i) => ({
                    h160,
                    points: pointsResults[i].success ? Number(pointsResults[i].value as bigint) : 0,
                }));
                result.sort((a, b) => b.points - a.points);
                setRows(result);
            } catch (err: any) {
                if (!cancelled) setError(err?.message ?? String(err));
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (error) {
        return (
            <div className="leaderboard">
                <h2>Galactic Leaderboard</h2>
                <div className="empty">Couldn't reach the contract: {error}</div>
            </div>
        );
    }

    if (rows === null) {
        return (
            <div className="leaderboard">
                <h2>Galactic Leaderboard</h2>
                <div className="spinner">Loading from contract...</div>
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="leaderboard">
                <h2>Galactic Leaderboard</h2>
                <div className="empty">No players have registered yet. Play a match to claim your spot.</div>
            </div>
        );
    }

    const selfKey = selfH160?.toLowerCase() ?? null;

    return (
        <div className="leaderboard">
            <h2>Galactic Leaderboard</h2>
            <div className="lb-table">
                {rows.map((row, i) => {
                    const isSelf = selfKey === row.h160.toLowerCase();
                    const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
                    const ptClass = row.points > 0 ? "positive" : row.points < 0 ? "negative" : "";
                    return (
                        <div key={row.h160} className={`lb-row${isSelf ? " self" : ""}`}>
                            <div className={`lb-rank ${rankClass}`}>#{i + 1}</div>
                            <div className="lb-address">
                                {short(row.h160)}{isSelf ? "  (you)" : ""}
                            </div>
                            <div className={`lb-points ${ptClass}`}>
                                {row.points > 0 ? `+${row.points}` : row.points}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
