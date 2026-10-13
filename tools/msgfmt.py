#!/usr/bin/env python3
"""Compile a gettext .po file into a .mo file.

A small stand-in for GNU msgfmt, which is not always installed: it handles
plural forms and contexts, and skips fuzzy and untranslated messages.

Usage: msgfmt.py INPUT.po OUTPUT.mo
"""

import ast
import struct
import sys

KEYWORDS = ('msgctxt', 'msgid', 'msgid_plural', 'msgstr')


def compile_entry(entry, fuzzy, messages):
    if 'msgid' not in entry:
        return
    key = entry['msgid']
    if 'msgctxt' in entry:
        key = entry['msgctxt'] + '\x04' + key
    if 'msgid_plural' in entry:
        key += '\0' + entry['msgid_plural']
        forms = sorted((int(k[7:-1]), v) for k, v in entry.items()
                       if k.startswith('msgstr['))
        value = '\0'.join(v for _, v in forms)
    else:
        value = entry.get('msgstr', '')
    is_header = entry['msgid'] == ''
    if value.strip('\0') and (is_header or not fuzzy):
        messages[key] = value


def parse_po(path):
    messages = {}
    entry, field, fuzzy = {}, None, False

    with open(path, encoding='utf-8') as po:
        for number, line in enumerate(po, 1):
            line = line.strip()
            if line.startswith('#'):
                # Flags come before the message they are about
                if line.startswith('#,') and 'fuzzy' in line:
                    compile_entry(entry, fuzzy, messages)
                    entry, field, fuzzy = {}, None, True
                continue
            if not line:
                continue
            if line.startswith('"'):
                if field is None:
                    sys.exit(f'{path}:{number}: string outside of a message')
                entry[field] += ast.literal_eval(line)
                continue

            keyword, _, string = line.partition(' ')
            if keyword not in KEYWORDS and not keyword.startswith('msgstr['):
                sys.exit(f'{path}:{number}: unknown keyword {keyword}')
            translated = any(k.startswith('msgstr') for k in entry)
            if keyword in ('msgctxt', 'msgid') and translated:
                compile_entry(entry, fuzzy, messages)
                entry, fuzzy = {}, False
            field = keyword
            entry[field] = ast.literal_eval(string)

    compile_entry(entry, fuzzy, messages)
    return messages


def write_mo(messages, path):
    keys = sorted(k.encode() for k in messages)
    values = [messages[k.decode()].encode() for k in keys]

    count = len(keys)
    originals_start = 7 * 4
    translations_start = originals_start + count * 8
    data_start = translations_start + count * 8

    tables, data = [], b''
    for strings in (keys, values):
        table = []
        for s in strings:
            table.append((len(s), data_start + len(data)))
            data += s + b'\0'
        tables.append(table)

    with open(path, 'wb') as mo:
        # magic, revision, count, both tables, no hash table
        mo.write(struct.pack('<7I', 0x950412de, 0, count,
                             originals_start, translations_start,
                             0, data_start))
        for table in tables:
            for length, offset in table:
                mo.write(struct.pack('<2I', length, offset))
        mo.write(data)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    write_mo(parse_po(sys.argv[1]), sys.argv[2])
