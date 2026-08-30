// Turns a user-entered transfer function G(s) = N(s)/D(s) (coefficients
// highest-degree-first) into a controllable-canonical-form state-space
// model, so the simulator isn't locked to one hardcoded plant.

export type StateSpace = {
  A: number[][];
  B: number[];
  C: number[];
  order: number;
};

export function parseCoeffList(input: string): number[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

export function formatCoeffList(coeffs: number[]): string {
  return coeffs.join(', ');
}

const MAX_ORDER = 4;

export function validateTF(num: number[], den: number[]): string | null {
  if (num.length === 0 || den.length === 0) return 'Enter at least one coefficient for both numerator and denominator.';
  if (num.some((c) => !Number.isFinite(c)) || den.some((c) => !Number.isFinite(c))) {
    return 'Coefficients must be valid numbers.';
  }
  if (den.length < 2) return 'Denominator must be at least 1st order (2 coefficients).';
  if (den.length - 1 > MAX_ORDER) return `Denominator order is capped at ${MAX_ORDER} for this simulator.`;
  if (den[0] === 0) return 'The leading denominator coefficient cannot be zero.';
  if (num.length >= den.length) {
    return 'G(s) must be strictly proper: the numerator order must be lower than the denominator order.';
  }
  return null;
}

/** Controllable canonical form for a strictly-proper G(s) = N(s)/D(s). */
export function toStateSpace(num: number[], den: number[]): StateSpace {
  const n = den.length - 1;
  const den0 = den[0];
  const a = den.slice(1).map((c) => c / den0); // a1..an
  const b0 = num.map((c) => c / den0); // b1..bk (k < n), highest degree first

  const b = new Array(n).fill(0);
  const offset = n - b0.length;
  for (let i = 0; i < b0.length; i++) b[offset + i] = b0[i];

  const A: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const row = new Array(n).fill(0);
    row[i + 1] = 1;
    A.push(row);
  }
  const lastRow = new Array(n).fill(0);
  for (let i = 0; i < n; i++) lastRow[i] = -a[n - 1 - i];
  A.push(lastRow);

  const B = new Array(n).fill(0);
  B[n - 1] = 1;

  const C = [...b].reverse(); // [bn, ..., b1]

  return { A, B, C, order: n };
}

export function stateDerivative(x: number[], u: number, ss: StateSpace): number[] {
  const n = x.length;
  const dx = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += ss.A[i][j] * x[j];
    dx[i] = s + ss.B[i] * u;
  }
  return dx;
}

export function outputOf(x: number[], C: number[]): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += C[i] * x[i];
  return s;
}

export function rk4StepGeneric(x: number[], u: number, ss: StateSpace, dt: number): number[] {
  const n = x.length;
  const add = (a: number[], b: number[], scale: number) => a.map((v, i) => v + b[i] * scale);

  const k1 = stateDerivative(x, u, ss);
  const k2 = stateDerivative(add(x, k1, dt / 2), u, ss);
  const k3 = stateDerivative(add(x, k2, dt / 2), u, ss);
  const k4 = stateDerivative(add(x, k3, dt), u, ss);

  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] = x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return out;
}

/** Formats a polynomial (highest-degree-first coefficients) as plain text, e.g. "s^2 + 9s + 20". */
export function formatPolynomial(coeffs: number[]): string {
  const n = coeffs.length - 1;
  const parts: string[] = [];
  coeffs.forEach((c, i) => {
    if (c === 0) return;
    const power = n - i;
    const abs = Math.abs(c);
    const coeffStr = abs === 1 && power !== 0 ? '' : `${abs}`;
    const varStr = power === 0 ? '' : power === 1 ? 's' : `s^${power}`;
    const term = `${coeffStr}${varStr}`;
    if (parts.length === 0) {
      parts.push(c < 0 ? `-${term}` : term);
    } else {
      parts.push(c < 0 ? `- ${term}` : `+ ${term}`);
    }
  });
  return parts.length ? parts.join(' ') : '0';
}
