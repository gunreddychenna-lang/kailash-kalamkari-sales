#!/usr/bin/env python3
"""Read-only Google Drive Desktop catalogue snapshot builder. No remote writes."""
import argparse, hashlib, json, os, pathlib, re, sys, tempfile
from collections import defaultdict
from datetime import datetime, timezone

SOURCES = [('Main Catalogue', r'G:\My Drive\Catalogue'), ('KHPS', r'H:\My Drive\Dhanalakshmi Kalamkari')]
EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
CATEGORY = {'floral':'Floral', 'story':'Story'}

def parse_name(filename):
    stem = pathlib.Path(filename).stem.strip()
    stem = re.sub(r'\s*\(\d+\)\s*$', '', stem).strip()
    if '&' not in stem:
        return 'Not Defined', 'Not Defined'
    design, colour = stem.rsplit('&', 1)
    return design.strip() or 'Not Defined', colour.strip() or 'Not Defined'

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for part in iter(lambda: f.read(1024*1024), b''):
            h.update(part)
    return h.hexdigest()

def atomic_write(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.kk-tmp-', dir=os.path.dirname(os.path.abspath(path)))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def scan(sources, state_path, snapshot_path, approve=False):
    if not all(os.path.isdir(root) for _, root in sources):
        raise RuntimeError('A required catalogue root is unavailable. No snapshot changed.')
    seen = []
    for store, root in sources:
        for current, subdirs, files in os.walk(root, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
            subdirs[:] = sorted(d for d in subdirs if not os.path.islink(os.path.join(current, d)))
            for filename in sorted(files):
                path = os.path.join(current, filename)
                if pathlib.Path(filename).suffix.lower() not in EXTS: continue
                if os.path.islink(path): continue
                rel = os.path.relpath(path, root)
                parts = pathlib.Path(rel).parts
                if len(parts) < 2: # Files at root require review, not silently classify as fabric.
                    raise RuntimeError(f'Image outside a fabric folder: {store}/{rel}')
                if not os.path.isfile(path): raise RuntimeError(f'Image disappeared during scan: {path}')
                category = next((CATEGORY[p.lower()] for p in parts[1:-1] if p.lower() in CATEGORY), 'Not Defined')
                design, colour = parse_name(filename)
                fabric = parts[0]
                typ = 'Dupatta' if 'dupatta' in fabric.lower() else 'Saree'
                before = os.stat(path)
                sha = digest(path)
                after = os.stat(path)
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError(f'Image modified during scan: {path}')
                seen.append(dict(store=store, type=typ, fabric=fabric, category=category,
                                 design=design, colour=colour, filename=filename,
                                 relative_path=rel.replace('\\','/'), content_sha256=sha,
                                 size=after.st_size))
    if not seen: raise RuntimeError('Both catalogue roots appear empty. Refusing destructive reconciliation.')
    prev = {'records': [], 'scan_number': 0}
    if os.path.isfile(state_path):
        with open(state_path, encoding='utf-8') as f: prev = json.load(f)
    # Fail closed if a previously populated store suddenly scans as empty.
    # This prevents a disconnected or incomplete Drive mount from
    # advancing missing-scan counters or removing inventory.
    previous_counts = defaultdict(int)
    observed_counts = defaultdict(int)

    for record in prev.get('records', []):
        previous_counts[record['store']] += 1

    for record in seen:
        observed_counts[record['store']] += 1

    for store, _ in sources:
        if previous_counts[store] > 0 and observed_counts[store] == 0:
            raise RuntimeError(
                f'Incomplete scan: {store} previously contained '
                f'{previous_counts[store]} images but now contains zero. '
                'State and snapshot were not changed.'
            )

        # Fail closed on suspiciously large sudden drops.
        # Real deletions should happen gradually across verified scans.
        if previous_counts[store] >= 20 and observed_counts[store] > 0:
            drop_ratio = observed_counts[store] / previous_counts[store]
            if drop_ratio < 0.5:
                raise RuntimeError(
                    f'Incomplete scan: {store} previously contained '
                    f'{previous_counts[store]} images but now contains '
                    f'{observed_counts[store]}. '
                    'Large unexpected drop detected. State and snapshot were not changed.'
                )

    # Match first by store + relative path; then by content hash for renames/moves.
    former = prev.get('records', [])
    used = set()
    by_path = {(r['store'], r['relative_path']): i for i,r in enumerate(former)}
    by_hash = defaultdict(list)
    for i,r in enumerate(former): by_hash[(r['store'], r['content_sha256'])].append(i)
    entries = []
    new_count = rename_count = 0
    for item in seen:
        idx = by_path.get((item['store'], item['relative_path']))
        if idx is not None and (idx in used or former[idx]['content_sha256'] != item['content_sha256']): idx = None
        if idx is None:
            idx = next((i for i in by_hash[(item['store'], item['content_sha256'])] if i not in used), None)
        if idx is None:
            item['stable_id'] = hashlib.sha256((item['store']+':'+item['relative_path']+':'+item['content_sha256']).encode()).hexdigest()[:24]
            new_count += 1
        else:
            used.add(idx)
            item['stable_id'] = former[idx]['stable_id']
            if item['relative_path'] != former[idx]['relative_path']: rename_count += 1
        item['missing_scans'] = 0
        entries.append(item)
    pending = removed = 0
    for i, old in enumerate(former):
        if i in used: continue
        old = old.copy()
        old['missing_scans'] = old.get('missing_scans',0) + 1
        if old['missing_scans'] >= 2:
            removed += 1
        else:
            pending += 1
            entries.append(old)
    counts = defaultdict(int)
    for r in entries: counts[r['store']] += 1
    print(json.dumps({'observed_images':len(seen), 'available_snapshot_images':len(entries),
                      'per_store':dict(counts),'new':new_count,'renamed_or_moved':rename_count,
                      'pending_deletion':pending,'confirmed_deletion':removed}, indent=2))
    if not approve:
        print('DRY RUN: no output files changed. Add --write to save a local snapshot.'); return
    snapshot = {'source':'local_drive_csv_audit','snapshot':True, 'total_images':len(entries),
                'items':[{k:r[k] for k in ('store','type','fabric','category','design','colour','filename')} for r in entries]}
    # Preserve state first; no production writes performed. Snapshot is only a local file.
    atomic_write(state_path, {'scan_number':prev.get('scan_number',0)+1,'records':entries})
    atomic_write(snapshot_path, snapshot)
    print('LOCAL files saved. This does NOT update your live website.')

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--write',action='store_true')
    p.add_argument('--root-kk', default=SOURCES[0][1]);p.add_argument('--root-khps',default=SOURCES[1][1])
    p.add_argument('--state', default='tools/inventory-scan-state.json')
    p.add_argument('--snapshot', default='lib/drive-audit-snapshot.json')
    a=p.parse_args()
    try: scan([('Main Catalogue',a.root_kk),('KHPS',a.root_khps)], a.state, a.snapshot,a.write)
    except Exception as e: print('SCAN FAILED:',e,file=sys.stderr);sys.exit(1)
