"""
Suivi des jobs de conversion en mémoire.
Volontairement simple (pas de Redis / DB) : suffisant pour un usage
mono-instance. Chaque job expire et son fichier temporaire est nettoyé
après TTL_SECONDS pour ne pas accumuler de fichiers sur le disque.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

TTL_SECONDS = 30 * 60  # 30 minutes


@dataclass
class Job:
    id: str
    status: str = "queued"          # queued | processing | done | error
    progress: int = 0               # 0-100
    message: str = ""
    source_filename: str = ""
    target_format: str = ""
    output_path: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, source_filename: str, target_format: str) -> Job:
        job = Job(
            id=uuid.uuid4().hex,
            source_filename=source_filename,
            target_format=target_format,
        )
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                for k, v in fields.items():
                    setattr(job, k, v)

    def sweep_expired(self, work_dir: Path) -> None:
        now = time.time()
        with self._lock:
            expired = [j for j in self._jobs.values() if now - j.created_at > TTL_SECONDS]
            for job in expired:
                if job.output_path:
                    p = Path(job.output_path)
                    if p.exists():
                        p.unlink(missing_ok=True)
                del self._jobs[job.id]


store = JobStore()
