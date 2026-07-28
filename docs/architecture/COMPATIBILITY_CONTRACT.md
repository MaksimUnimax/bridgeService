# Compatibility Contract

Direct сохраняет бизнес-механику текущего Bridge: создание задания, operation ID, статусы, idempotency, отмену, получение отчёта и повторное получение отчёта. Timeout, ограничения размера, cadence/counters, cursor и ошибки должны иметь совместимую наблюдаемую семантику. Повтор запроса не повторяет исполнение; cancel идемпотентен; отчёт доступен после завершения по operation ID.

Конкретный legacy endpoint или wire mechanism не фиксируется до source baseline и помечается `NEEDS_SOURCE_CONFIRMATION`; реальный mapping утверждается в BB2-DIRECT-08. Legacy transport сохраняется временным fallback. Direct не использует legacy DB, secrets, state или logs.

Серверы разделяются профилями, а задания и отчёты — conversation ID; credentials, sequence, cursors и очереди не пересекаются. Краткий обрыв восстанавливается автоматически, restart требует только «Подключить» при прежней identity. Payload защищён application-layer encryption.
