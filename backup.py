import shutil, os, stat, pathlib, sys
sys.stdout.reconfigure(encoding='utf-8')

def _force_remove(func, path, exc_info):
    """Handle read-only files on Windows during rmtree."""
    os.chmod(path, stat.S_IWRITE)
    func(path)

src = pathlib.Path(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub')
dst_base = pathlib.Path(r'C:\Users\robert.barnett\My Drive\Documents\Claude\Projects\pktHub_backups')

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
