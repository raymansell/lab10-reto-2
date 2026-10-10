const errors = {
  E001: [401, 'no autorizado'],
  E100: [400, 'json inválido'],
  E102: [400, 'falta m'],
  E103: [400, 'falta control'],
  E104: [400, 'segmento vacío'],
  E201: [400, 'control mal formado'],
  E202: [400, 'control inválido'],
  E301: [400, 'comando desconocido '],
  E302: [400, 'aridad inválida'],
  E401: [404, 'cuenta inexistente'],
  E402: [404, 'operación inexistente'],
  E404: [404, 'ruta desconocida'],
  // S-02: respuesta provisional, sin evidencia del original para importes inválidos.
  E501: [422, 'importe inválido'],
  E506: [422, 'límite excedido'],
  E507: [422, 'saldo insuficiente'],
};

export const result = (status, body) => ({ status, body });
export function error(code, extra = {}) {
  const [status, mensaje] = errors[code];
  return result(status, { error: code, mensaje, ...extra });
}
