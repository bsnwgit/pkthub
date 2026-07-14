# Rotates a 2-copy local backup of the project directory before making
# significant changes: backup_1 (most recent) and backup_2 (previous).
#
# Usage:
#   python3 backup.py --src <path-to-project> --dst-base <path-to-backups-dir>
# or:
#   PKTHUB_BACKUP_SRC=<path> PKTHUB_BACKUP_DST=<path> python3 backup.py
import argparse
import os
import pathlib
import shutil
import stat
import sys

sys.stdout.reconfigure(encoding='utf-8')


def _force_remove(func, path, exc_info):
    """Handle read-only files on Windows during rmtree."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default=os.environ.get("PKTHUB_BACKUP_SRC"),
                         help="Path to the project directory to back up")
    parser.add_argument("--dst-base", default=os.environ.get("PKTHUB_BACKUP_DST"),
                         help="Path to the directory that will hold backup_1/backup_2")
    args = parser.parse_args()
    missing = [name for name, val in (("--src/PKTHUB_BACKUP_SRC", args.src),
                                       ("--dst-base/PKTHUB_BACKUP_DST", args.dst_base)) if not val]
    if missing:
        parser.error(f"missing required value(s): {', '.join(missing)}")
    return args


def main():
    args = parse_args()
    src = pathlib.Path(args.src)
    dst_base = pathlib.Path(args.dst_base)

    ignore = shutil.ignore_patterns(
        'node_modules', '__pycache__', '.git', '*.pyc', '*.pyo',
        'venv', '.venv', '*_backups', '*.log', '.DS_Store'
    )

    backup_2 = dst_base / 'backup_2'
    backup_1 = dst_base / 'backup_1'

    dst_base.mkdir(parents=True, exist_ok=True)

    if backup_2.exists():
        shutil.rmtree(backup_2, onerror=_force_remove)
    if backup_1.exists():
        shutil.move(str(backup_1), str(backup_2))

    shutil.copytree(src, backup_1, ignore=ignore)
    print(f'Backup complete -> {backup_1}')


if __name__ == "__main__":
    main()
