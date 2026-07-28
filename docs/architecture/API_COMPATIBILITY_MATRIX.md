# API compatibility matrix

| Функция текущего Bridge | Текущий endpoint/механизм | Целевой endpoint/механизм | Сохранённая семантика | Допустимое изменение | Ран | Проверка |
|---|---|---|---|---|---|---|
| Создание задания | `NEEDS_SOURCE_CONFIRMATION` | Direct API, mapping в BB2-DIRECT-08 | Создаёт одну operation ID | Только carrier/envelope | 08 | Реальный create + duplicate |
| Статус | `NEEDS_SOURCE_CONFIRMATION` | Direct status operation | Те же состояния и cadence | Формат transport error | 08 | State transition test |
| Отмена | `NEEDS_SOURCE_CONFIRMATION` | Direct cancel operation | Идемпотентна | Auth envelope добавляется | 08 | Повтор cancel |
| Получение отчёта | `NEEDS_SOURCE_CONFIRMATION` | Direct report operation | Отчёт по operation ID | Encrypted envelope | 08 | Complete/report test |
| Повторное получение | `NEEDS_SOURCE_CONFIRMATION` | Direct report повторно | Не запускает job | Cursor/headers могут отличаться | 09 | Duplicate read |
| Idempotency | `NEEDS_SOURCE_CONFIRMATION` | request ID + durable ledger | Повтор не дублирует job | Поля envelope versioned | 08–09 | Replay/duplicate |
| Timeout/size | `NEEDS_SOURCE_CONFIRMATION` | Configured Direct limits | Ошибка и границы предсказуемы | Лимиты уточняются source baseline | 08 | Boundary tests |
| Reconnect | `NEEDS_SOURCE_CONFIRMATION` | heartbeat/backoff/cursor | Краткий обрыв прозрачен | Timing может измениться | 14 | Network interruption |
| Диалоговая изоляция | `NEEDS_SOURCE_CONFIRMATION` | profile + conversation binding | Нет смешения заданий | Требуется явный profile ID | 13 | Two profiles/conversations |

Ни один endpoint не считается утверждённым до появления source evidence.
