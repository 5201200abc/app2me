import type { SqliteMigration } from "./migration-types.js";
export const migration0018: SqliteMigration = {
  appVersion: "0.15.2",
  id: "0018_session_input_failed_status",
  // fork bundle 提交后 child runtime 仍可能同步启动失败。该输入已经被 parent
  // accepted fact 接受，不能伪装成 cancelled/discarded；新增 durable failed 终态，并通过
  // 重建 CHECK 保证旧库升级后也能写入，重启不会再次消费或改写它。
  sql: `
      alter table session_input rename to session_input_before_failed_status;

      create table session_input (
        id text primary key,
        session_id text not null references session(id) on delete cascade,
        kind text not null,
        delivery text not null check(delivery in ('startNow', 'guide', 'queue')),
        payload text not null,
        admitted_sequence integer not null,
        promoted_sequence integer,
        promoted_message_id text,
        status text not null check(status in ('admitted', 'promoted', 'cancelled', 'discarded', 'failed')),
        status_reason text,
        time_created integer not null,
        time_updated integer not null
      );

      insert into session_input (
        id, session_id, kind, delivery, payload, admitted_sequence,
        promoted_sequence, promoted_message_id, status, status_reason,
        time_created, time_updated
      )
      select
        id, session_id, kind, delivery, payload, admitted_sequence,
        promoted_sequence, promoted_message_id, status, status_reason,
        time_created, time_updated
      from session_input_before_failed_status;

      drop table session_input_before_failed_status;

      create index session_input_session_admitted_idx
        on session_input(session_id, admitted_sequence);
      create index session_input_session_status_idx
        on session_input(session_id, status);
    `,
};
