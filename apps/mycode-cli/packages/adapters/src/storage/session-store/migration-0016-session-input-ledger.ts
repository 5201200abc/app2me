import type { SqliteMigration } from "./migration-types.js";
export const migration0016: SqliteMigration = {
  appVersion: "0.15.2",
  id: "0016_session_input_ledger",
  // session_input 账本：输入的 durable 生命周期
  // admitted -> promoted / cancelled / discarded。队列/唤醒的存在性若只在
  // 进程内存（事件日志也是内存的），崩溃即静默丢；账本让「queue 消失但不进
  // history」不可能静默发生，并为输入类 command 提供 durable 幂等。
  sql: `
      create table if not exists session_input (
        id text primary key,
        session_id text not null references session(id) on delete cascade,
        kind text not null,
        delivery text not null check(delivery in ('guide', 'queue')),
        payload text not null,
        admitted_sequence integer not null,
        promoted_sequence integer,
        promoted_message_id text,
        status text not null check(status in ('admitted', 'promoted', 'cancelled', 'discarded')),
        status_reason text,
        time_created integer not null,
        time_updated integer not null
      );

      create index if not exists session_input_session_admitted_idx
        on session_input(session_id, admitted_sequence);
      create index if not exists session_input_session_status_idx
        on session_input(session_id, status);
    `,
};
