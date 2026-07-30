"""One bounded in-process worker; it never executes a subprocess or shell."""
from __future__ import annotations
import threading
from . import tasks

class DurableWorker:
    def __init__(self, database_path: str, stop: threading.Event) -> None:
        self.database_path=database_path; self.stop=stop; self.thread=threading.Thread(target=self._run,name="direct-worker",daemon=True)
    def start(self) -> None: self.thread.start()
    def join(self, timeout: float=5.0) -> None: self.thread.join(timeout)
    def _run(self) -> None:
        while not self.stop.wait(0.25):
            try:
                lease=tasks.claim(self.database_path)
                if lease: tasks.complete(self.database_path,lease["task_id"],lease["worker_id"],lease["lease_token"],lease["attempt_number"])
            except Exception:
                # Safe code only; a failed claim/complete is left for recovery.
                continue
