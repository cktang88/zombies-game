# usage: python3 -I tools/sfx-fetch.py <opengameart slug>...  (needs py7zr for .7z packs)
# Downloads OpenGameArt entries into tools/.cache/sfx-src/<slug>/ (git-ignored) — only if the page lists CC0.
# Archives are untrusted: only audio members are extracted, flattened, with sanitized names.
import sys, re, os, json, html, urllib.request, urllib.parse, zipfile, io
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tools/.cache/sfx-src')
AUD = re.compile(r'\.(wav|ogg|mp3|flac|aif|aiff|oga)$', re.I)
def safe(n): return re.sub(r'[^A-Za-z0-9._-]+', '_', os.path.basename(n))[:120]
def get(u): return urllib.request.urlopen(urllib.request.Request(u), timeout=120).read()
for slug in sys.argv[1:]:
    try:
        d = get(f'https://opengameart.org/content/{slug}').decode('utf8', 'replace')
    except Exception as e:
        print('ERR', slug, e); continue
    m = re.search(r'field-name-field-art-licenses(.*?)field-name-(collect|favorites)', d, re.S)
    lics = re.findall(r"license-name'>([^<]+)<", m.group(1)) if m else []
    if 'CC0' not in lics:
        print('SKIP (not CC0)', slug, lics); continue
    auth = re.findall(r'field-name-author-submitter.*?<a href="/users/([^"]+)"', d, re.S)
    title = html.unescape(re.findall(r'<title>([^|<]*)', d)[0].strip())
    files = list(dict.fromkeys(re.findall(r'<a href="([^"]+)" type="[^"]*"[^>]*download=', d)))
    out = os.path.join(ROOT, slug); os.makedirs(out, exist_ok=True)
    got = []
    for f in files:
        f = urllib.parse.urljoin('https://opengameart.org/', f)
        name = safe(urllib.parse.unquote(f))
        try:
            data = get(f)
        except Exception as e:
            print('  ERR', f, e); continue
        try:
            if name.lower().endswith('.zip'):
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for zi in z.infolist():
                        if not zi.is_dir() and AUD.search(zi.filename) and zi.file_size < 60e6 and '__MACOSX' not in zi.filename:
                            n = safe(zi.filename); open(os.path.join(out, n), 'wb').write(z.read(zi)); got.append(n)
            elif name.lower().endswith('.7z'):
                import py7zr
                with py7zr.SevenZipFile(io.BytesIO(data)) as z:
                    names = [n for n in z.getnames() if AUD.search(n) and '..' not in n and not n.startswith('/')]
                    import tempfile, shutil
                    tmp = tempfile.mkdtemp(dir=ROOT)
                    z.extract(path=tmp, targets=names)
                    for dp, _, fns in os.walk(tmp):
                        for fn in fns:
                            if AUD.search(fn):
                                nn = safe(fn); shutil.move(os.path.join(dp, fn), os.path.join(out, nn)); got.append(nn)
                    shutil.rmtree(tmp)
            elif AUD.search(name):
                open(os.path.join(out, name), 'wb').write(data); got.append(name)
            else:
                print('  ignoring', name)
        except Exception as e:
            print('  ERR extract', name, e)
    json.dump({'slug': slug, 'url': f'https://opengameart.org/content/{slug}', 'title': title, 'author': auth[0] if auth else '?', 'licenses': lics, 'files': got}, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    print(f'{slug}: {title} by {auth[:1]} {lics} -> {len(got)} files')
