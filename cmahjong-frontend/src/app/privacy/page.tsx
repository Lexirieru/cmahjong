import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy — cMahjong" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        cMahjong is designed to collect as little personal data as possible. We do not ask for your
        name, email, or phone number to play.
      </p>

      <h2>What we process</h2>
      <p>
        Your wallet address (to join games and receive prizes) and gameplay data (moves, results)
        needed to run a fair game. Game state is stored on our backend and the final results settle
        on the public Celo blockchain. Your address is shown to others only as an in-app alias, never
        as a raw address.
      </p>

      <h2>What we do not collect</h2>
      <p>
        We do not collect names, emails, phone numbers, precise location, or device contacts. We do
        not sell data. We have no access to your wallet keys or funds.
      </p>

      <h2>On-chain data</h2>
      <p>
        Transactions on Celo (entries, settlements, withdrawals) are public and permanent by the
        nature of blockchains, and are outside our control.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, email{" "}
        <a className="text-gold-400" href="mailto:axelmatsama@gmail.com">
          axelmatsama@gmail.com
        </a>
        .
      </p>
    </LegalPage>
  );
}
