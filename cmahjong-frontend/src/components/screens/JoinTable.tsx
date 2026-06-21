"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { BackTitle } from "./CreateTable";
import { readGameCount } from "@/lib/contract";

export function JoinTable({ onBack, onJoin }: { onBack: () => void; onJoin: (gameId: bigint) => void }) {
  const [code, setCode] = useState("");
  const [latest, setLatest] = useState<bigint | null>(null);

  useEffect(() => {
    readGameCount().then(setLatest).catch(() => {});
  }, []);

  const valid = /^\d+$/.test(code) && BigInt(code || "0") > 0n;

  return (
    <div className="flex flex-1 flex-col px-5">
      <BackTitle title="Join a table" onBack={onBack} />

      <div className="flex-1 space-y-4 pt-2">
        <p className="text-[15px] text-ivory/65">Enter the table number shared by the host.</p>
        <div className="flex items-center rounded-2xl surface px-4">
          <span className="text-2xl font-semibold text-ivory/40">#</span>
          <input
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="h-16 flex-1 bg-transparent pl-2 text-3xl font-semibold outline-none placeholder:text-ivory/25"
          />
        </div>
        {latest !== null && latest > 0n && (
          <button
            onClick={() => setCode(latest.toString())}
            className="text-sm text-gold-400"
          >
            Latest table is #{latest.toString()}
          </button>
        )}
      </div>

      <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button disabled={!valid} onClick={() => onJoin(BigInt(code))}>
          Continue
        </Button>
      </div>
    </div>
  );
}
