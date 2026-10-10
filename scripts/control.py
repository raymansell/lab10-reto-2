"""Control de Caja Negra: filtrar ASCII, mapear A=1..Z=26 y módulo 97.

Este módulo calcula integridad; no normaliza los argumentos de ejecución.
"""


def control(payload: str) -> str:
    remainder = 0
    for char in payload:
        if '0' <= char <= '9':
            digits = char
        elif 'A' <= char <= 'Z':
            digits = str(ord(char) - ord('A') + 1)
        elif 'a' <= char <= 'z':
            digits = str(ord(char) - ord('a') + 1)
        else:
            continue
        for digit in digits:
            remainder = (remainder * 10 + int(digit)) % 97
    return str(98 - (remainder * 100) % 97)


def message(payload: str) -> str:
    return payload + ';' + control(payload)
