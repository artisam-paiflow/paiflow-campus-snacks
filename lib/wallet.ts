"use client";
import {
  requestAccess,
  getAddress,
  getNetworkDetails,
  signTransaction,
} from "@stellar/freighter-api";
import type { Prepared } from "@/lib/paiflow";
export async function connectWallet() {
  const result = await requestAccess();
  if (result.error) throw new Error(result.error.message);
  if (!result.address)
    throw new Error("Install Freighter and allow this app to connect.");
  return result.address;
}
export async function refreshWallet() {
  const result = await getAddress();
  if (result.error) throw new Error(result.error.message);
  return result.address;
}
export async function signPrepared(prepared: Prepared, address: string) {
  if (
    prepared.network !== "testnet" ||
    prepared.networkPassphrase !== "Test SDF Network ; September 2015"
  )
    throw new Error("Only Testnet payments are allowed.");
  const expires = Date.parse(prepared.expiresAt);
  if (!Number.isFinite(expires) || Date.now() >= expires)
    throw new Error("Preparation expired. Prepare again.");
  if ((await refreshWallet()) !== address)
    throw new Error("Wallet changed. Refresh wallet and prepare again.");
  const network = await getNetworkDetails();
  if (network.error) throw new Error(network.error.message);
  if (network.networkPassphrase !== prepared.networkPassphrase)
    throw new Error("Switch Freighter to Testnet before signing.");
  const signed = await signTransaction(prepared.xdr, {
    networkPassphrase: prepared.networkPassphrase,
    address,
  });
  if (signed.error) throw new Error(signed.error.message);
  if (!signed.signedTxXdr)
    throw new Error("Freighter did not return a signed transaction.");
  if (signed.signerAddress !== address)
    throw new Error(
      "Freighter signed with a different customer. Refresh wallet and prepare again.",
    );
  return signed.signedTxXdr;
}
