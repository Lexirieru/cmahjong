"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { celo } from "viem/chains";

/** MahjongTable (UUPS proxy) di Celo mainnet. */
export const MAHJONG_ADDRESS = "0xBEE2D162aD3f3de655A74Bf5E79F37bb96aE0EC4" as Address;
export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMiniPay?: boolean };
  }
}

/** Wallet client memakai provider yang di-inject (MiniPay / wallet apa pun). */
export function getWalletClient() {
  if (typeof window === "undefined" || !window.ethereum) return null;
  return createWalletClient({
    chain: celo,
    transport: custom(window.ethereum),
  });
}

/**
 * MiniPay hanya mendukung transaksi LEGACY (tanpa EIP-1559). Helper ini memaksa
 * tipe legacy + gas price dari jaringan agar transaksi diterima MiniPay.
 */
export async function legacyGas() {
  const gasPrice = await publicClient.getGasPrice();
  return { gasPrice, type: "legacy" as const };
}

/**
 * Pastikan wallet berada di Celo sebelum mengirim transaksi. Bila berbeda jaringan,
 * minta wallet pindah (tambahkan jaringan dulu bila belum ada). Di MiniPay ini no-op.
 */
export async function ensureCeloChain() {
  const wallet = getWalletClient();
  if (!wallet) throw new Error("No wallet connected");
  const current = await wallet.getChainId();
  if (current === celo.id) return;
  try {
    await wallet.switchChain({ id: celo.id });
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e.code === 4902 || /unrecognized|not added|add this/i.test(e.message ?? "")) {
      await wallet.addChain({ chain: celo });
      await wallet.switchChain({ id: celo.id });
    } else {
      throw new Error("Switch your wallet to the Celo network to continue");
    }
  }
}
