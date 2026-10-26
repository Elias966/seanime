#!/usr/bin/env python3
"""Repack the official Seanime 3.10.4 Linux x86_64 AppImage with this fork's fix."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ORIGINAL_SHA256 = 'bc1d3b5b045b1be1378f4501afc436bf282c052d5fb254513addf2e3af7014f5'
ORIGINAL_WORKER_SHA256 = '8b16fa788be8ca5d36571539dbf6915018fbbc46f095277770126f0bc791aac9'
SQUASHFS_OFFSET = 188392
ROOT = Path(__file__).resolve().parents[1]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def patch_asar(path):
    raw = path.read_bytes()
    _, header_size, _, json_size = struct.unpack('<4I', raw[:16])
    tree = json.loads(raw[16:16 + json_size])
    base = 8 + header_size
    worker = tree['files']['web-denshi']['files']['jassub']['files']['jassub-worker.js']
    start = base + int(worker['offset'])
    if sha256(raw[start:start + worker['size']]) != ORIGINAL_WORKER_SHA256:
        raise ValueError('Unexpected original JASSUB worker; refusing to patch')
    public = ROOT / 'seanime-web/public'
    changed = {
        'web-denshi/jassub/jassub-worker.js': (public / 'jassub/jassub-worker.js').read_bytes(),
        'web-denshi/fonts/DejaVuSans.ttf': (public / 'fonts/DejaVuSans.ttf').read_bytes(),
        'web-denshi/fonts/DejaVuSans.LICENSE.txt': (public / 'fonts/DejaVuSans.LICENSE.txt').read_bytes(),
    }
    for name in changed:
        node = tree
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'][part]
        node['files'].setdefault(parts[-1], {})
    chunks = []
    offset = 0
    block_size = 4 * 1024 * 1024

    def walk(node, prefix=''):
        nonlocal offset
        for name, entry in node['files'].items():
            full_name = prefix + name
            if 'files' in entry:
                walk(entry, full_name + '/')
            elif 'link' in entry or entry.get('unpacked'):
                continue
            else:
                data = changed.get(full_name)
                if data is None:
                    start = base + int(entry['offset'])
                    data = raw[start:start + entry['size']]
                entry['offset'] = str(offset)
                entry['size'] = len(data)
                offset += len(data)
                chunks.append(data)
                if full_name in changed:
                    entry['integrity'] = {
                        'algorithm': 'SHA256', 'hash': sha256(data), 'blockSize': block_size,
                        'blocks': [sha256(data[i:i + block_size]) for i in range(0, len(data), block_size)],
                    }
    walk(tree)
    header_json = json.dumps(tree, separators=(',', ':')).encode()
    padding = (-len(header_json)) % 4
    header = struct.pack('<II', 4 + len(header_json) + padding, len(header_json)) + header_json + b'\0' * padding
    path.write_bytes(struct.pack('<II', 4, len(header)) + header + b''.join(chunks))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--processors', type=int, default=4)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; choose a new path')
    if args.processors < 1:
        parser.error('--processors must be positive')
    for tool in ('unsquashfs', 'mksquashfs'):
        if not shutil.which(tool):
            parser.error('Missing dependency: ' + tool + ' (install squashfs-tools)')
    original = args.original.resolve()
    output = args.output.resolve()
    data = original.read_bytes()
    if sha256(data) != ORIGINAL_SHA256:
        parser.error('Expected the unmodified official seanime-denshi-3.10.4_Linux_x86_64.AppImage')
    if data[SQUASHFS_OFFSET:SQUASHFS_OFFSET + 4] != b'hsqs':
        parser.error('Unexpected SquashFS offset')
    with tempfile.TemporaryDirectory(prefix='seanime-arabic-') as temp:
        temp = Path(temp)
        app_dir = temp / 'AppDir'
        subprocess.run(['unsquashfs', '-no-progress', '-o', str(SQUASHFS_OFFSET), '-d', str(app_dir), str(original)], check=True)
        patch_asar(app_dir / 'resources/app.asar')
        # Preserve upstream startup and bundle the Python standard-library adapter.
        app_run = app_dir / 'AppRun'
        app_run.rename(app_dir / 'AppRun.upstream')
        shutil.copyfile(ROOT / 'scripts/arabic-translation/AppRun', app_run)
        app_run.chmod(0o755)
        shutil.copyfile(ROOT / 'scripts/arabic-translation/translation_helper.py',
                        app_dir / 'resources/seanime-translation-helper.py')
        filesystem = temp / 'patched.squashfs'
        subprocess.run(['mksquashfs', str(app_dir), str(filesystem), '-noappend', '-comp', 'xz', '-processors', str(args.processors), '-quiet'], check=True)
        with output.open('xb') as dest:
            dest.write(data[:SQUASHFS_OFFSET])
            with filesystem.open('rb') as source:
                shutil.copyfileobj(source, dest)
        output.chmod(0o755)
    print(sha256(output.read_bytes()) + '  ' + output.name)


if __name__ == '__main__':
    main()
