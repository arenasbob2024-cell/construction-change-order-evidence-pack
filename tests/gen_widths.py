import fitz, json

for name in ("helv", "hebo"):
    f = fitz.Font(name)
    widths = {}
    for code in range(32, 127):
        ch = chr(code)
        try:
            w = f.glyph_advance(ord(ch))
        except Exception as exc:
            w = None
        widths[ch] = round(w, 3) if w is not None else None
    print(name, "ascender", f.ascender, "descender", f.descender)
    print(json.dumps(widths, sort_keys=True))
