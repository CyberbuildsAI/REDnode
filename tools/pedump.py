"""Minimal PE64 export/import dumper. Usage: python -I pedump.py <file> [more files]"""
import struct
import sys


def parse(path):
    d = open(path, "rb").read()
    pe = struct.unpack_from("<I", d, 0x3C)[0]
    assert d[pe:pe + 4] == b"PE\0\0", "not a PE file"
    nsec = struct.unpack_from("<H", d, pe + 6)[0]
    optsz = struct.unpack_from("<H", d, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", d, opt)[0]
    assert magic == 0x20B, "not PE32+"
    dd = opt + 112
    exp_rva, exp_sz = struct.unpack_from("<II", d, dd)
    imp_rva, _ = struct.unpack_from("<II", d, dd + 8)
    secs = []
    so = opt + optsz
    for i in range(nsec):
        name, vsz, va, rsz, raw = struct.unpack_from("<8sIIII", d, so + i * 40)
        secs.append((name.rstrip(b"\0").decode(), va, max(vsz, rsz), raw))

    def off(rva):
        for _, va, sz, raw in secs:
            if va <= rva < va + sz:
                return raw + rva - va
        raise ValueError(hex(rva))

    def cstr(o):
        e = d.index(b"\0", o)
        return d[o:e].decode("latin1")

    exports = []
    if exp_rva:
        e = off(exp_rva)
        nfun, nnames, afun, anames, aords = struct.unpack_from("<IIIII", d, e + 20)
        for i in range(nnames):
            nrva = struct.unpack_from("<I", d, off(anames) + 4 * i)[0]
            exports.append(cstr(off(nrva)))
    imports = {}
    if imp_rva:
        o = off(imp_rva)
        while True:
            oft, _, _, name_rva, ft = struct.unpack_from("<IIIII", d, o)
            if not name_rva:
                break
            dll = cstr(off(name_rva))
            funcs = []
            t = off(oft or ft)
            while True:
                v = struct.unpack_from("<Q", d, t)[0]
                if not v:
                    break
                if v >> 63:
                    funcs.append("#%d" % (v & 0xFFFF))
                else:
                    funcs.append(cstr(off(v & 0x7FFFFFFF) + 2))
                t += 8
            imports[dll] = funcs
            o += 20
    return exports, imports


for p in sys.argv[1:]:
    ex, im = parse(p)
    print("=== %s" % p.split("\\")[-1])
    print("exports (%d): %s" % (len(ex), ", ".join(ex[:40]) or "-"))
    print("import DLLs (%d): %s" % (len(im), ", ".join(sorted(im))))
