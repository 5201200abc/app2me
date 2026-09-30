import type { DatabaseSync } from "node:sqlite";
import type { ForkCommitFaultStage } from "./options.js";
export interface StoreWriteTransactionContext {
  db: DatabaseSync;
  beforeWrite(): void;
}
export interface StoreForkTransactionContext extends StoreWriteTransactionContext {
  onForkCommitStage(stage: ForkCommitFaultStage): void;
}
