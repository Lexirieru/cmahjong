"use client";

import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { Button } from "@/components/Button";
import { ensureCeloChain, getWalletClient } from "@/lib/chain";
import { MAHJONG_ADDRESS, mahjongAbi, legacyGas, sendCreateGame } from "@/lib/contract";
import { TOKENS } from "@/lib/tokens";
import { fmt } from "@/lib/format";

const SERVER = (process.env.NEXT_PUBLIC_SERVER_ADDRESS ??
  "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E") as Address;
const PAYOUT: readonly [number, number, number, number] = [5000, 3000, 1500, 500];
const PRESETS = ["1", "5", "10"];

export function CreateTable({
  address,
  onBack,
  onCreated,
}: {
  address: Address;
  onBack: () => void;
  onCreated: (gameId: bigint) => void;
}) {
  const [tokenIdx, setTokenIdx] = useState(0);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = TOKENS[tokenIdx];

  async function create() {
    setError(null);
    const wallet = getWalletClient();
    if (!wallet || !amount || Number(amount) <= 0) return;
    setBusy(true);
    try {
      await ensureCeloChain();
      const buyIn = parseUnits(amount, token.decimals);
      const gas = await legacyGas();
      const id = await sendCreateGame(
        wallet.writeContract({
          address: MAHJONG_ADDRESS,
          abi: mahjongAbi,
          functionName: "createGame",
          args: [token.address, buyIn, SERVER, PAYOUT, 3600n, 1800n, 1800n],
          account: address,
          ...gas,
        }),
      );
      onCreated(id);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5">
      <BackTitle title="New table" onBack={onBack} />

      <div className="flex-1 space-y-6 pt-2">
        <Field label="Buy-in currency">
          <div className="grid grid-cols-4 gap-2">
            {TOKENS.map((t, i) => (
              <button
                key={t.symbol}
                onClick={() => setTokenIdx(i)}
                className={`h-11 rounded-xl text-sm font-medium transition-colors ${
                  i === tokenIdx ? "bg-gold-400 text-ink" : "surface text-ivory/80"
                }`}
              >
                {t.symbol}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Buy-in per player">
          <div className="flex items-center rounded-2xl surface px-4">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                // accept comma as the decimal separator (id-ID) -> normalize to a dot
                let v = e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
                const i = v.indexOf(".");
                if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ""); // single dot only
                setAmount(v);
              }}
              className="h-14 flex-1 bg-transparent text-2xl font-semibold outline-none"
            />
            <span className="text-ivory/50">{token.symbol}</span>
          </div>
          <div className="mt-2 flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setAmount(p)}
                className="rounded-full surface px-3 py-1 text-xs text-ivory/70"
              >
                {p}
              </button>
            ))}
          </div>
        </Field>

        <div className="rounded-2xl surface p-4 text-sm">
          <Row label="Players" value="4" />
          <Row label="Total pot" value={`${fmt(Number(amount || 0) * 4)} ${token.symbol}`} />
          <Row label="Payout (1st–4th)" value="50 · 30 · 15 · 5%" />
          <Row label="House rake" value="3%" last />
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button onClick={create} loading={busy}>
          Create table
        </Button>
      </div>
    </div>
  );
}

export function BackTitle({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <button onClick={onBack} className="surface flex h-9 w-9 items-center justify-center rounded-full">
        ‹
      </button>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-ivory/45">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-1.5 ${last ? "" : "border-b border-white/8"}`}>
      <span className="text-ivory/55">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
