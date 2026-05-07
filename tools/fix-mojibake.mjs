import { readFileSync, writeFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

const files = process.argv.slice(2);
const decoder = new TextDecoder('utf-8', { fatal: false });
const cp1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function byteFor(ch) {
  const code = ch.codePointAt(0);
  if (code <= 0xff) return code;
  return cp1252.get(code);
}

function decodeCp1252Utf8(segment) {
  const bytes = [];
  for (const ch of segment) {
    const b = byteFor(ch);
    if (b === undefined) return segment;
    bytes.push(b);
  }
  const fixed = decoder.decode(Uint8Array.from(bytes));
  return /[\u0600-\u06ff\u2000-\u27ff\u{1f300}-\u{1faff}]/u.test(fixed) ? fixed : segment;
}

function repair(text) {
  text = text.split(/\r?\n/).map((line) => {
    if (/[ØÙÃÂâð]/.test(line) && !/[\u0600-\u06ff]/.test(line)) {
      return decodeCp1252Utf8(line);
    }
    return line;
  }).join('\n');
  text = text.replace(/[ÂÃØÙâð][\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2026\u2030\u2039\u203a\u20ac\u2122]+/g, (segment) => decodeCp1252Utf8(segment));
  // Repair only runs that contain common Arabic UTF-8 mojibake markers.
  return text.replace(/(?:[A-Za-z0-9 _.,:;!?#"'`()[\]{}<>/=+\-*&|\\\r\n\t$@%،؛؟]*[ØÙÃÂâð][A-Za-z0-9 _.,:;!?#"'`()[\]{}<>/=+\-*&|\\\r\n\t$@%،؛؟ØÙÃÂâð€Œ™œ،؛؟]+)+/g, (segment) => {
    if (!/[ØÙÃÂâ]/.test(segment)) return segment;
    return decodeCp1252Utf8(segment);
  });
}

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = repair(before);
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    console.log(`fixed ${file}`);
  }
}
