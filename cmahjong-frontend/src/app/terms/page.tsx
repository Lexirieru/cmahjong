import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Service — cMahjong" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        cMahjong is a skill-based riichi mahjong game. Four players each contribute an equal
        stablecoin entry that forms a prize pool, paid out by final standing (50 / 30 / 15 / 5%).
        The operator takes no house cut. By playing, you agree to these terms.
      </p>

      <h2>Skill game, not gambling</h2>
      <p>
        Outcomes are determined by player skill across a full hand of riichi mahjong. The tile wall
        is shuffled deterministically from an on-chain commit–reveal seed, so any player can verify
        the deal was fair. cMahjong is not a casino and does not operate a house bank.
      </p>

      <h2>Entries and prizes</h2>
      <p>
        Entries are held in a public, verified escrow smart contract on Celo. When a game settles,
        the prize pool is credited to players by rank and can be withdrawn to your wallet. Network
        fees are paid in stablecoins via MiniPay. You are responsible for the funds in your wallet.
      </p>

      <h2>Eligibility</h2>
      <p>
        You must be of legal age in your jurisdiction and use cMahjong only where permitted by local
        law. Do not use the app if real-money skill competitions are restricted where you live.
      </p>

      <h2>No warranty</h2>
      <p>
        The app and smart contracts are provided “as is”, without warranty. Blockchain transactions
        are irreversible. To the maximum extent permitted by law, the operator is not liable for
        losses arising from use of the app, network conditions, or wallet issues.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or issues? Email{" "}
        <a className="text-gold-400" href="mailto:axelmatsama@gmail.com">
          axelmatsama@gmail.com
        </a>
        . We aim to respond to critical issues within 24 hours.
      </p>
    </LegalPage>
  );
}
