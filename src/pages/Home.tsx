import type { SignerAccount } from "@polkadot-apps/signer";
import MyProfile from "./MyProfile.tsx";

export default function Home({ account, onSolo, onLeaderboard, refreshKey }: {
    account: SignerAccount | null;
    onSolo: () => void;
    onLeaderboard: () => void;
    refreshKey?: number;
}) {
    return (
        <div>
            {account && <MyProfile account={account} refreshKey={refreshKey} />}

            <div className="home">
                <div className="home-title">Cosmic Tic-Tac-Toe</div>
                <div className="home-subtitle">Play X vs O in deep space</div>

                <div className="home-modes">
                    <div className="mode-card" onClick={onSolo}>
                        <div className="mode-card-title">Solo</div>
                        <div className="mode-card-desc">Best of 3 vs CPU — results synced to the leaderboard contract</div>
                    </div>
                    <div className="mode-card" onClick={onLeaderboard}>
                        <div className="mode-card-title">Leaderboard</div>
                        <div className="mode-card-desc">All players ranked by points — read live from the contract</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
