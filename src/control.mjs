// CTRL-01/03: filtrar ASCII antes de cualquier expansión Unicode.
export function control(payload) {
  let remainder = 0;
  for (const char of payload) {
    let digits;
    if (char >= '0' && char <= '9') digits = char;
    else if (char >= 'A' && char <= 'Z') digits = String(char.charCodeAt(0) - 64);
    else if (char >= 'a' && char <= 'z') digits = String(char.charCodeAt(0) - 96);
    else continue;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return String(98 - (remainder * 100) % 97);
}

export const message = (payload) => `${payload};${control(payload)}`;
