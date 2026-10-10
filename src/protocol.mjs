import { control } from './control.mjs';
import { error } from './responses.mjs';

const arities = new Map([
  ['PING', 0], ['ALTA', 1], ['CONSULTA', 1], ['DEPOSITO', 2], ['TRANSFER', 3], ['ANULA', 1],
]);

function distance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) {
      next.push(Math.min(next[j] + 1, previous[j + 1] + 1,
        previous[j] + (left[i] === right[j] ? 0 : 1)));
    }
    previous = next;
  }
  return previous[right.length];
}

function suggestion(command) {
  // S-03: Levenshtein <= 2 es una generalización provisional de las sugerencias observadas.
  let nearest;
  let best = 3;
  for (const name of arities.keys()) {
    if (Math.abs(name.length - command.length) > 2) continue;
    const score = distance(command, name);
    if (score < best) { best = score; nearest = name; }
  }
  return nearest;
}

export function parseMessage(body) {
  if (body === null || typeof body !== 'object' || typeof body.m !== 'string') {
    return { failure: error('E102') };
  }
  const parts = body.m.split(';');
  if (parts.length < 2) return { failure: error('E103') };
  if (parts.some((part) => part === '')) return { failure: error('E104') };
  const supplied = parts.pop();
  // No trim: el control y la ejecución tienen normalizaciones distintas.
  const command = parts[0].toUpperCase();
  const args = parts.slice(1);
  if (command !== 'PING') {
    if (supplied.length > 2 || /[^0-9]/.test(supplied)) return { failure: error('E201') };
    if (supplied !== control(parts.join(';'))) return { failure: error('E202') };
  }
  if (!arities.has(command)) {
    const hint = suggestion(command);
    return { failure: error('E301', hint ? { sugerencia: hint } : {}) };
  }
  if (args.length !== arities.get(command)) return { failure: error('E302') };
  return { command, args };
}
