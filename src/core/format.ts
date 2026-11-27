export function formatMicros6(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

export function parseDecimalAmount(raw: string): { num: bigint; scale: bigint } {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return { num: BigInt(trimmed), scale: 1n };
  }
  const whole = trimmed.slice(0, dot);
  const frac = trimmed.slice(dot + 1);
  return {
    num: BigInt(`${whole}${frac}`),
    scale: 10n ** BigInt(frac.length),
  };
}

export function roundHalfUpSigned(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Le dénominateur doit être strictement positif.");
  }
  const doubled = numerator * 2n;
  if (doubled >= 0n) {
    return (doubled + denominator) / (2n * denominator);
  }
  const absNum = -numerator;
  const q = absNum / denominator;
  const r = absNum % denominator;
  const roundedAbs = r * 2n > denominator ? q + 1n : q;
  return roundedAbs === 0n ? 0n : -roundedAbs;
}

export function assertSafeInt(val: bigint, detail: string): number {
  if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Dépassement de capacité entière sécuritaire ${detail}.`);
  }
  return Number(val);
}
