"""Basic smoke test for local development and post-deploy sanity checks."""

from pathlib import Path


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    targets = [
        base_dir / "app.py",
        base_dir / "storage.py",
        base_dir / "cloud_sync.py",
        base_dir / "analytics.py",
        base_dir / "ai_generator.py",
    ]
    for path in targets:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
        print(f"OK {path.name}")


if __name__ == "__main__":
    main()
