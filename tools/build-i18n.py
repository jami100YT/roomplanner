#!/usr/bin/env python3
"""Baut die Übersetzungen aus tools/i18n-table.tsv in public/index.html ein.
Spalte 1 = deutscher Originaltext (Schlüssel), danach je eine Spalte pro Sprache.
Aufruf: python3 tools/build-i18n.py"""
import json, re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(root, 'tools/i18n-table.tsv'), encoding='utf-8') if l.strip()]
head, rows = rows[0], rows[1:]
bad = [r[0] for r in rows if len(r) != len(head)]
if bad: sys.exit('Falsche Spaltenzahl: ' + repr(bad))
keys = [r[0] for r in rows]
dups = {k for k in keys if keys.count(k) > 1}
if dups: sys.exit('Doppelte Schlüssel: ' + repr(dups))
d = {lang: {r[0]: r[i] for r in rows} for i, lang in enumerate(head) if i > 0}
js = json.dumps(d, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
p = os.path.join(root, 'public/index.html')
s = open(p, encoding='utf-8').read()
block = '<!--I18N-->\n<script>window.I18N=' + js + ';</script>\n<!--/I18N-->'
if '<!--I18N-->' in s:
    s = re.sub(r'<!--I18N-->.*?<!--/I18N-->', lambda m: block, s, flags=re.S)
else:
    i = s.index('<script>\n/* ---------- Sprachen')
    s = s[:i] + block + '\n' + s[i:]
open(p, 'w', encoding='utf-8').write(s)
print(len(rows), 'Texte ×', len(head) - 1, 'Sprachen eingebaut')
