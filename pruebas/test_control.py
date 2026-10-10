"""Regresión local de la fórmula; no llama al original."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from control import control, message


class ControlTests(unittest.TestCase):
    def test_examples(self):
        examples = [json.loads(line) for line in (ROOT / 'pruebas/ejemplos.jsonl').read_text().splitlines()]
        for row in examples:
            payload, supplied = row['request']['m'].rsplit(';', 1)
            if row['response'].get('error') in ('E201', 'E202'):
                self.assertNotEqual(control(payload), supplied)
            else:
                self.assertEqual(control(payload), supplied)

    def test_discovered_pairs(self):
        for path in (ROOT / 'pruebas/control').glob('*.found.json'):
            for pair in json.loads(path.read_text()):
                with self.subTest(payload=pair['payload']):
                    self.assertEqual(control(pair['payload']), str(pair['control']))

    def test_confirmed_predictions(self):
        files = list((ROOT / 'pruebas/control').glob('*.verification.fixtures.jsonl'))
        self.assertTrue(files, 'Faltan fixtures verificadas contra el original')
        for path in files:
            for line in path.read_text().splitlines():
                case = json.loads(line)['case']
                with self.subTest(message=case['message']):
                    computed = message(case['payload'])
                    if case['kind'] == 'valid':
                        self.assertEqual(computed, case['message'])
                    else:
                        self.assertNotEqual(computed, case['message'])

    def test_remainder_without_large_integer_conversion(self):
        # Referencia independiente con enteros arbitrarios, por debajo del límite de Python.
        payload = '1234567890' * 100
        expected = str(98 - int(payload + '00') % 97)
        self.assertEqual(control(payload), expected)


if __name__ == '__main__':
    unittest.main()
