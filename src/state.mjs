import { parseMessage } from './protocol.mjs';
import { error, result } from './responses.mjs';

// S-01: 100000 aceptado y 120000 rechazado; el umbral exacto sigue pendiente.
export const TRANSFER_LIMIT = 100_000;

function amount(value) {
  // S-02: solo enteros positivos seguros; otros formatos y overflow usan E501 provisional.
  if (!value || /[^0-9]/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createEngine(saved) {
  let accounts;
  let operations;
  let nextAccount;
  let nextOperation;

  function reset() {
    accounts = new Map();
    operations = new Map();
    nextAccount = 1;
    nextOperation = 1;
    return result(200, { ok: true });
  }
  reset();
  if (saved) {
    const copy = structuredClone(saved);
    accounts = new Map(copy.accounts);
    operations = new Map(copy.operations);
    nextAccount = copy.nextAccount;
    nextOperation = copy.nextOperation;
  }

  function snapshot() {
    return structuredClone({ accounts: [...accounts], operations: [...operations], nextAccount, nextOperation });
  }

  function record(operation) {
    const id = `OP-${String(nextOperation++).padStart(4, '0')}`;
    operations.set(id, { ...operation, cancelled: false });
    return result(200, { status: 'recieved', operacionId: id });
  }

  // Sin await: validación y transición se completan atómicamente en el event loop.
  function dispatch(body) {
    const parsed = parseMessage(body);
    if (parsed.failure) return parsed.failure;
    const { command, args } = parsed;
    if (command === 'PING') return result(200, { pong: true });
    if (command === 'ALTA') {
      const id = `AC-${String(nextAccount++).padStart(4, '0')}`;
      accounts.set(id, { name: args[0], balance: 0 });
      return result(201, { cuentaId: id });
    }
    if (command === 'CONSULTA') {
      const account = accounts.get(args[0]);
      return account ? result(200, { cuenta_id: args[0], saldo: account.balance }) : error('E401');
    }
    if (command === 'ANULA') {
      const operation = operations.get(args[0]);
      if (!operation) return error('E402');
      if (operation.cancelled) return result(200, { ok: false, motivo: 'ya anulada' });
      if (operation.type === 'deposit') {
        const account = accounts.get(operation.to);
        if (!Number.isSafeInteger(account.balance - operation.amount)) return error('E501');
        account.balance -= operation.amount;
      } else {
        const from = accounts.get(operation.from);
        const to = accounts.get(operation.to);
        if (from !== to) {
          if (!Number.isSafeInteger(from.balance + operation.amount)
            || !Number.isSafeInteger(to.balance - operation.amount)) return error('E501');
          from.balance += operation.amount;
          to.balance -= operation.amount;
        }
      }
      operation.cancelled = true;
      return result(200, { ok: true, anulada: args[0] });
    }
    if (command === 'DEPOSITO') {
      const account = accounts.get(args[0]);
      if (!account) return error('E401');
      const value = amount(args[1]);
      if (value === null || !Number.isSafeInteger(account.balance + value)) return error('E501');
      account.balance += value;
      return record({ type: 'deposit', to: args[0], amount: value });
    }
    const from = accounts.get(args[0]);
    const to = accounts.get(args[1]);
    if (!from || !to) return error('E401');
    const value = amount(args[2]);
    if (value === null) return error('E501');
    if (value > TRANSFER_LIMIT) return error('E506');
    if (from.balance < value) return error('E507');
    // S-04: autoenvío aceptado con fondos; saldo neto cero y operación anulable.
    if (from !== to) {
      if (!Number.isSafeInteger(from.balance - value) || !Number.isSafeInteger(to.balance + value)) {
        return error('E501');
      }
      from.balance -= value;
      to.balance += value;
    }
    return record({ type: 'transfer', from: args[0], to: args[1], amount: value });
  }
  return { dispatch, reset, snapshot };
}
