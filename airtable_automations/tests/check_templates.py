#!/usr/bin/env python3
"""Check the Postmark templates for unbalanced or malformed Mustache tags.

Postmark parses {{ }} everywhere, including inside HTML comments, so a stray
tag in a comment fails the whole template. Run before every paste:

    python3 airtable_automations/tests/check_templates.py
"""
import pathlib, re, sys

TEMPLATES = pathlib.Path(__file__).resolve().parent.parent / "templates"
TAG = re.compile(r"\{\{\{?\s*([#^/]?)\s*([^}]*?)\s*\}?\}\}")
NAME = re.compile(r"^[A-Za-z_.:][\w.:]*$")


def check(path):
    text, stack, problems = path.read_text(), [], []
    for m in TAG.finditer(text):
        kind, name = m.group(1), m.group(2)
        line = text.count("\n", 0, m.start()) + 1
        if not NAME.match(name):
            problems.append(f"line {line}: not a valid tag: {m.group(0)}")
        if kind in ("#", "^"):
            stack.append((name, line))
        elif kind == "/":
            if stack and stack[-1][0] == name:
                stack.pop()
            else:
                problems.append(f"line {line}: closes '{name}' but the open section is {stack[-1] if stack else 'none'}")
    problems += [f"line {line}: section '{name}' is never closed" for name, line in stack]
    return problems


failed = False
for path in sorted(list(TEMPLATES.glob("*postmark*.html")) + list(TEMPLATES.glob("*postmark*.txt"))):
    if " copy" in path.name:
        continue
    problems = check(path)
    print(f"{'FAIL' if problems else 'ok  '} {path.name}")
    for p in problems:
        print(f"       {p}")
    failed = failed or bool(problems)
sys.exit(1 if failed else 0)
