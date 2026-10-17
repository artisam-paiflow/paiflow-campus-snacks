export const TESTNET = "Test SDF Network ; September 2015";
export type Prepared = {
  xdr: string;
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  expiresAt: string;
  preparationRequestId?: string;
  txHash: string;
};
export type Submitted = {
  txHash: string;
  status: "SUCCESS" | "PENDING" | "FAILED" | "UNKNOWN" | "REJECTED";
  network?: "testnet" | "mainnet";
  ledger?: number;
  error?: { code: string; message: string };
};
