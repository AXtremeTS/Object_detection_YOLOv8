# PyInstaller spec file for ui_backend
# Run with: pyinstaller ui_backend.spec

import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ['ui_backend.py'],
    pathex=[str(Path('.').resolve())],
    binaries=[],
    datas=[
        # Bundle model weights if they exist locally
        ('yolov8s.pt',     '.') if Path('yolov8s.pt').exists()     else ('requirements.txt', '.'),
        ('yolov8s-seg.pt', '.') if Path('yolov8s-seg.pt').exists() else ('requirements.txt', '.'),
    ],
    hiddenimports=[
        'ultralytics',
        'ultralytics.nn',
        'ultralytics.nn.tasks',
        'ultralytics.nn.modules',
        'ultralytics.utils',
        'ultralytics.utils.ops',
        'ultralytics.models',
        'ultralytics.models.yolo',
        'ultralytics.models.yolo.detect',
        'ultralytics.models.yolo.segment',
        'cv2',
        'numpy',
        'PIL',
        'torch',
        'torchvision',
        'scipy',
        'sklearn',
        'yaml',
        'pkg_resources',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'flask', 'tkinter', 'PyQt5', 'wx'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ui_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # keep console=True so stdout/stdin pipe works
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='ui_backend',
)
