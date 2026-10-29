# -*- coding: utf-8 -*-
"""심평원 CSV 머리글과 표본 행을 찍어 본다 (구조 확인용)."""
import csv
import io
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
csv.field_size_limit(10_000_000)

for path in sys.argv[1:]:
    for enc in ("cp949", "utf-8-sig", "utf-8"):
        try:
            with io.open(path, encoding=enc, newline="") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = [next(reader) for _ in range(2)]
        except (UnicodeDecodeError, StopIteration):
            continue
        print(f"== {os.path.basename(path)} | enc={enc} | cols={len(header)}")
        print("   HDR: " + " | ".join(header))
        for row in rows:
            print("   ROW: " + " | ".join(row[:16]))
        break
    else:
        print(f"!! 읽지 못함: {path}")
    print()
