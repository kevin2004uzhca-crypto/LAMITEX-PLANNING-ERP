export function directRequirement(quantity: number, base: number, planned: number) {
  if (![quantity, base, planned].every(Number.isFinite) || base <= 0 || planned < 0) throw new Error('Cantidades inválidas');
  return quantity / base * planned;
}
