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
from patch_media_electron import MAIN_PATH, PRELOAD_PATH, patch_main, patch_preload
from patch_media_player import NATIVE_PLAYER_PATH, patch_native_player
from patch_download_navigation import MAGNET_PATH, patch_download_entry, patch_magnet, patch_download_bootstrap
from patch_entry_navigation import SEARCH_PATH, patch_search, patch_entry, patch_bootstrap
from patch_subtitle_scheduler import BUNDLE_PATH, patch_player_bundle

ORIGINAL_SHA256 = 'bc1d3b5b045b1be1378f4501afc436bf282c052d5fb254513addf2e3af7014f5'
ORIGINAL_WORKER_SHA256 = '8b16fa788be8ca5d36571539dbf6915018fbbc46f095277770126f0bc791aac9'
SQUASHFS_OFFSET = 188392
ROOT = Path(__file__).resolve().parents[1]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def patch_asar(path, web_dir=None):
    raw = path.read_bytes()
    _, header_size, _, json_size = struct.unpack('<4I', raw[:16])
    tree = json.loads(raw[16:16 + json_size])
    base = 8 + header_size
    worker = tree['files']['web-denshi']['files']['jassub']['files']['jassub-worker.js']
    start = base + int(worker['offset'])
    if sha256(raw[start:start + worker['size']]) != ORIGINAL_WORKER_SHA256:
        raise ValueError('Unexpected original JASSUB worker; refusing to patch')
    if web_dir:
        # A source-built frontend already contains the overlay scripts and hooks, so it replaces web-denshi wholesale.
        if not (web_dir / 'index.html').is_file() or not (web_dir / 'media-hub.js').is_file():
            raise ValueError('--web-dir must be a seanime-web out-denshi build')
        tree['files']['web-denshi'] = {'files': {}}
        changed = {'web-denshi/' + f.relative_to(web_dir).as_posix(): f.read_bytes()
                   for f in sorted(web_dir.rglob('*')) if f.is_file()}
        return write_asar(path, raw, base, tree, changed)
    public = ROOT / 'seanime-web/public'
    media_data = (public / 'media-hub.js').read_bytes()
    media_name = 'media-hub.' + sha256(media_data)[:8] + '.js'
    hls_data = (ROOT / 'scripts/media-hub/node_modules/hls.js/dist/hls.min.js').read_bytes()
    hls_name = 'hls.' + sha256(hls_data)[:8] + '.js'
    progress_data = (public / 'translation-progress.js').read_bytes()
    queue_data = (public / 'subtitle-translation-queue.js').read_bytes()
    navigation_data = (public / 'entry-navigation.js').read_bytes()
    navigation_name = 'entry-navigation.' + sha256(navigation_data)[:8] + '.js'
    cover_data = (public / 'cover-picker.js').read_bytes()
    cover_name = 'cover-picker.' + sha256(cover_data)[:8] + '.js'
    artwork_data = (public / 'offline-artwork.js').read_bytes()
    artwork_name = 'offline-artwork.' + sha256(artwork_data)[:8] + '.js'
    progress_name = 'translation-progress.' + sha256(progress_data)[:8] + '.js'
    queue_name = 'subtitle-translation-queue.' + sha256(queue_data)[:8] + '.js'
    changed = {
        'web-denshi/' + media_name: media_data,
        'web-denshi/' + hls_name: hls_data,
        'web-denshi/' + cover_name: cover_data,
        'web-denshi/' + navigation_name: navigation_data,
        'web-denshi/jassub/jassub-worker.js': (public / 'jassub/jassub-worker.js').read_bytes(),
        'web-denshi/fonts/DejaVuSans.ttf': (public / 'fonts/DejaVuSans.ttf').read_bytes(),
        'web-denshi/' + queue_name: queue_data,
        'web-denshi/' + artwork_name: artwork_data,
        'web-denshi/' + progress_name: progress_data,
        'web-denshi/fonts/DejaVuSans.LICENSE.txt': (public / 'fonts/DejaVuSans.LICENSE.txt').read_bytes(),
    }
    bundle_entry = tree
    for part in BUNDLE_PATH.split('/'):
        bundle_entry = bundle_entry['files'][part]
    start = base + int(bundle_entry['offset'])
    bundle_data = patch_download_entry(patch_entry(patch_player_bundle(raw[start:start + bundle_entry['size']])))
    magnet_entry=tree
    for part in MAGNET_PATH.split('/'): magnet_entry=magnet_entry['files'][part]
    magnet_start=base+int(magnet_entry['offset'])
    magnet_data=patch_magnet(raw[magnet_start:magnet_start+magnet_entry['size']])
    magnet_hash=sha256(magnet_data)[:8]
    changed[MAGNET_PATH.replace('77c02207',magnet_hash)]=magnet_data
    search_entry=tree
    for part in SEARCH_PATH.split('/'): search_entry=search_entry['files'][part]
    search_start=base+int(search_entry['offset'])
    search_data=patch_search(raw[search_start:search_start+search_entry['size']])
    search_hash=sha256(search_data)[:8]
    changed[SEARCH_PATH.replace('23d2cc71',search_hash)]=search_data
    native_entry = tree
    for part in NATIVE_PLAYER_PATH.split('/'): native_entry = native_entry['files'][part]
    native_start=base+int(native_entry['offset'])
    native_data=patch_native_player(raw[native_start:native_start+native_entry['size']])
    native_hash=sha256(native_data)[:8]
    changed[NATIVE_PLAYER_PATH.replace('73d63145',native_hash)]=native_data
    bundle_hash = sha256(bundle_data)[:8]
    changed[BUNDLE_PATH.replace('4d10fc5d', bundle_hash)] = bundle_data
    # New content-addressed URLs prevent reuse of a cached pre-fix player chunk.
    bootstrap_path = 'web-denshi/static/js/index.c4fd1c85.js'
    bootstrap_entry = tree
    for part in bootstrap_path.split('/'):
        bootstrap_entry = bootstrap_entry['files'][part]
    start = base + int(bootstrap_entry['offset'])
    bootstrap = raw[start:start + bootstrap_entry['size']].decode()
    old_reference = '9195:"4d10fc5d"'
    if bootstrap.count(old_reference) != 1:
        raise ValueError('Unexpected frontend chunk map')
    if bootstrap.count('559:"73d63145"')!=1:raise ValueError('Unexpected native player chunk map')
    bootstrap=bootstrap.replace('559:"73d63145"','559:"'+native_hash+'"',1)
    bootstrap = bootstrap.replace(old_reference, '9195:"' + bundle_hash + '"', 1)
    # Resolve the common Image component's final src, including all cover variants.
    image_source = 'L=p||(R?y.src:y),M=R?y.blurDataURL:void 0;'
    if bootstrap.count(image_source) != 1:
        raise ValueError('Unexpected shared Image component')
    bootstrap = bootstrap.replace(image_source,
        'L=window.SeanimeResolveImageUrl?.(p||(R?y.src:y),R?y.src:y)??(p||(R?y.src:y)),M=R?y.blurDataURL:void 0;', 1)
    cover_hook = 'let[P,O]=(0,i.useState)(!1),R="object"==typeof y'
    if bootstrap.count(cover_hook) != 1:
        raise ValueError('Unexpected shared Image state hook')
    bootstrap = bootstrap.replace(cover_hook,
        'let[P,O]=(0,i.useState)(!1),[,refreshCover]=(0,i.useState)(0);(0,i.useEffect)(()=>{const f=()=>refreshCover(n=>n+1);window.addEventListener("seanime:covers-changed",f);return()=>window.removeEventListener("seanime:covers-changed",f)},[]);let R="object"==typeof y', 1)
    image_reset = '(0,i.useEffect)(n,[b.src]);let x=u&&b.src'
    if bootstrap.count(image_reset) != 1:
        raise ValueError('Unexpected shared Image retry effect')
    bootstrap = bootstrap.replace(image_reset,
        '(0,i.useEffect)(()=>{n();window.addEventListener("online",n);window.addEventListener("seanime:artwork-ready",n);return()=>{window.removeEventListener("online",n);window.removeEventListener("seanime:artwork-ready",n)}},[b.src,n]);let x=u&&b.src', 1)
    bootstrap_data = patch_download_bootstrap(patch_bootstrap(bootstrap.encode(), search_hash), magnet_hash)
    new_bootstrap_path = bootstrap_path.replace('c4fd1c85', sha256(bootstrap_data)[:8])
    changed[new_bootstrap_path] = bootstrap_data
    index_entry = tree['files']['web-denshi']['files']['index.html']
    start = base + int(index_entry['offset'])
    index_html = raw[start:start + index_entry['size']].decode()
    index_html = index_html.replace('/static/js/index.c4fd1c85.js', '/' + new_bootstrap_path.removeprefix('web-denshi/'), 1)
    changed['web-denshi/index.html'] = index_html.replace(
        '</head>', '<script src="/' + hls_name + '"></script><script src="/' + media_name + '"></script><script src="/' + cover_name + '"></script><script src="/' + navigation_name + '"></script><script src="/' + artwork_name + '"></script><script src="/' + progress_name + '"></script><script src="/' + queue_name + '"></script></head>', 1).encode()
    main_entry = tree
    for part in MAIN_PATH.split('/'): main_entry = main_entry['files'][part]
    main_start = base + int(main_entry['offset'])
    changed[MAIN_PATH] = patch_main(raw[main_start:main_start + main_entry['size']])
    preload_entry=tree
    for part in PRELOAD_PATH.split('/'):preload_entry=preload_entry['files'][part]
    preload_start=base+int(preload_entry['offset'])
    changed[PRELOAD_PATH]=patch_preload(raw[preload_start:preload_start+preload_entry['size']])
    write_asar(path, raw, base, tree, changed)


def write_asar(path, raw, base, tree, changed):
    for name in (MAIN_PATH, PRELOAD_PATH):
        if name not in changed:
            entry = tree
            for part in name.split('/'): entry = entry['files'][part]
            start = base + int(entry['offset'])
            changed[name] = (patch_main if name == MAIN_PATH else patch_preload)(raw[start:start + entry['size']])
    for name in changed:
        node = tree
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'].setdefault(part, {'files': {}})
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
    parser.add_argument('--web-dir', type=Path, help='Use a source-built frontend (seanime-web/out-denshi) instead of patching the bundled one')
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
        patch_asar(app_dir / 'resources/app.asar', args.web_dir.resolve() if args.web_dir else None)
        # Preserve upstream startup and bundle the Python standard-library adapter.
        app_run = app_dir / 'AppRun'
        app_run.rename(app_dir / 'AppRun.upstream')
        shutil.copyfile(ROOT / 'scripts/arabic-translation/AppRun', app_run)
        app_run.chmod(0o755)
        shutil.copyfile(ROOT / 'scripts/arabic-translation/translation_helper.py',
                        app_dir / 'resources/seanime-translation-helper.py')
        shutil.copyfile(ROOT / 'scripts/arabic-translation/artwork_cache.py',
                        app_dir / 'resources/artwork_cache.py')
        shutil.copyfile(ROOT / 'scripts/arabic-translation/cover_store.py',
                        app_dir / 'resources/cover_store.py')
        shutil.copyfile(ROOT / 'scripts/arabic-translation/media_hub.py', app_dir / 'resources/media_hub.py')
        shutil.copyfile(ROOT / 'scripts/media-hub/sources.json', app_dir / 'resources/sources.json')
        shutil.copytree(ROOT / 'scripts/media-hub', app_dir / 'resources/media-hub', ignore=shutil.ignore_patterns('test-*', 'test_*', '*.log', '__pycache__'))
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
