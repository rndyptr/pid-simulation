import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import InvertedPendulum from '@/components/InvertedPendulum';
import { type Mode, type Params, useOrder2Sim } from '@/lib/useOrder2Sim';
import { formatPolynomial, parseCoeffList, validateTF } from '@/lib/transferFunction';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';

const chartConfig = {
  y: { label: 'y(t) measured', color: 'var(--color-chart-4)' },
  u: { label: 'u(t)', color: 'var(--color-chart-2)' },
} satisfies ChartConfig;

const DEFAULT_NUM = '1';
const DEFAULT_DEN = '1, 9, 20';

// Each preset ships with gains known to behave sensibly for that plant -
// switching plants without retuning gains can make an otherwise-fine
// controller diverge wildly, which looks like a bug rather than a lesson.
const PLANT_PRESETS: { label: string; num: string; den: string; gains: { Kp: number; Ki: number; Kd: number } }[] = [
  { label: 'Default (2nd order)', num: '1', den: '1, 9, 20', gains: { Kp: 25, Ki: 4, Kd: 6 } },
  { label: '1st order', num: '1', den: '1, 5', gains: { Kp: 15, Ki: 3, Kd: 1 } },
  { label: 'Underdamped', num: '10', den: '1, 2, 10', gains: { Kp: 1, Ki: 0.5, Kd: 0.3 } },
  { label: '3rd order', num: '1', den: '1, 6, 11, 6', gains: { Kp: 25, Ki: 4, Kd: 6 } },
  {
    label: 'Unstable example',
    num: '4',
    den: '1, -1, 4',
    gains: { Kp: 0.1, Ki: 0, Kd: 0 },
  },
];

function Slider({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex justify-between items-baseline mb-2 gap-2">
        <span className="text-[13px] text-muted-foreground">
          {label}
          {hint && <InfoTip text={hint} />}
        </span>
        <span className="font-mono text-[13px] font-semibold text-foreground whitespace-nowrap">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full bg-border accent-foreground cursor-pointer"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[12.5px] text-muted-foreground mb-1.5">{label}</div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full font-mono text-[13px] bg-background border border-input rounded-md px-2.5 py-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    </div>
  );
}

// Gauge geometry: one shared angle convention (0 = pointing up, positive = clockwise)
// used for the arc endpoints, the tick marks, AND the needle rotation, so they
// are guaranteed to agree instead of relying on hand-typed path coordinates.
const CX = 80,
  CY = 80,
  R = 62;
const START_ANGLE = -125,
  END_ANGLE = 125,
  SWEEP = END_ANGLE - START_ANGLE;
const ARC_LEN = R * (SWEEP * (Math.PI / 180));

function polar(radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

const arcStart = polar(R, START_ANGLE);
const arcEnd = polar(R, END_ANGLE);
const ARC_PATH = `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${R} ${R} 0 1 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;

// The gauge's empty position (0% fill, needle at the very start of the
// track) is pinned to y = 0, so an idle/zeroed system visibly reads as
// "nothing yet" rather than starting partway around the dial.
const DIAL_LO = 0;
const DIAL_HI = 8;

function Dial({ y, sp }: { y: number; sp: number }) {
  const frac = Math.max(0, Math.min(1, (y - DIAL_LO) / (DIAL_HI - DIAL_LO)));
  const color = y < sp - 0.3 ? '#7DC4F2' : y > sp + 0.3 ? '#FF8F8F' : '#5EE3A3';
  const angle = START_ANGLE + frac * SWEEP;

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 160 160" className="w-full h-full">
        <defs>
          <filter id="needleShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.4" floodColor="black" floodOpacity="0.45" />
          </filter>
        </defs>

        <path d={ARC_PATH} fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
        <path
          d={ARC_PATH}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={ARC_LEN}
          strokeDashoffset={ARC_LEN * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 80ms linear, stroke 200ms' }}
        />

        {/* tick marks, on the same angle convention as the arc and needle */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const a = START_ANGLE + f * SWEEP;
          const inner = polar(70, a);
          const outer = polar(76, a);
          return (
            <line
              key={f}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--muted-foreground)"
              strokeWidth="1.5"
            />
          );
        })}

        <g
          transform={`rotate(${angle} ${CX} ${CY})`}
          style={{ transition: 'transform 80ms linear' }}
          filter="url(#needleShadow)"
        >
          <polygon points="80,26 84,79 76,79" fill="var(--foreground)" />
          <polygon points="80,92 82.5,79 77.5,79" fill="var(--muted-foreground)" />
        </g>
        <circle cx={CX} cy={CY} r="7" fill="var(--card)" stroke="var(--foreground)" strokeWidth="2" />
        <circle cx={CX} cy={CY} r="2.5" fill="var(--foreground)" />
      </svg>
      <div className="absolute inset-x-0 top-[60%] flex flex-col items-center">
        <div className="font-mono text-2xl font-semibold text-foreground">{y.toFixed(2)}</div>
        <div className="font-mono text-[10.5px] tracking-wide text-muted-foreground mt-0.5">
          y(t) &mdash; SYSTEM OUTPUT
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('PID');
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [params, setParams] = useState<Params>({ Kp: 25, Ki: 4, Kd: 6, hyst: 0.3, SP: 3 });

  const [numText, setNumText] = useState(DEFAULT_NUM);
  const [denText, setDenText] = useState(DEFAULT_DEN);
  const parsedNum = useMemo(() => parseCoeffList(numText), [numText]);
  const parsedDen = useMemo(() => parseCoeffList(denText), [denText]);
  const tfError = useMemo(() => validateTF(parsedNum, parsedDen), [parsedNum, parsedDen]);

  const [appliedNum, setAppliedNum] = useState<number[]>(() => parseCoeffList(DEFAULT_NUM));
  const [appliedDen, setAppliedDen] = useState<number[]>(() => parseCoeffList(DEFAULT_DEN));

  useEffect(() => {
    // Deliberately keep the last valid plant active while the field holds
    // an invalid draft, instead of breaking the simulation mid-edit. Must
    // depend on the parsed arrays themselves (not just tfError), otherwise
    // editing from one valid G(s) straight to another valid one - where
    // tfError stays null throughout - would never re-apply the change.
    if (!tfError) {
      setAppliedNum(parsedNum);
      setAppliedDen(parsedDen);
    }
  }, [tfError, parsedNum, parsedDen]);

  const patch = (p: Partial<Params>) => setParams((prev) => ({ ...prev, ...p }));

  const resetPlant = () => {
    setNumText(DEFAULT_NUM);
    setDenText(DEFAULT_DEN);
    setMode('PID');
    patch(PLANT_PRESETS[0].gains);
  };

  const sim = useOrder2Sim(mode, params, running, speed, appliedNum, appliedDen);

  const error = params.SP - sim.y;
  const actuatorState: 'pos' | 'neg' | 'zero' = sim.u > 0.5 ? 'pos' : sim.u < -0.5 ? 'neg' : 'zero';

  const ySpan = useMemo(() => {
    const lo = Math.min(-1, params.SP - 2);
    const hi = Math.max(params.SP + 2, 6);
    return [lo, hi] as const;
  }, [params.SP]);

  const plantLabel = `${formatPolynomial(appliedNum)} / (${formatPolynomial(appliedDen)})`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <div className="px-5 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header id="top" className="flex flex-wrap items-end justify-between gap-6 scroll-mt-20">
          <div className="max-w-2xl">
            <div className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground mb-2">
              Physics Lab &middot; Control Systems
            </div>
            <h1 className="font-serif text-4xl md:text-[2.75rem] font-medium tracking-tight">
              2nd-Order Control System Simulator
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed mt-2.5">
              Compare ON/OFF and PID control on a configurable plant, and see how Kp, Ki, and Kd shape the system
              output y(t) as it tracks a reference r(t).
            </p>
          </div>
          <div className="font-mono text-xs border border-border bg-card rounded-lg px-3.5 py-2.5 text-muted-foreground whitespace-nowrap">
            Plant: <b className="text-foreground">G(s) = {plantLabel}</b>
          </div>
        </header>

        <Card>
          <CardContent className="grid grid-cols-1 md:grid-cols-[160px_auto_1fr] items-center gap-8 p-6 md:p-7">
            <Dial y={sim.y} sp={params.SP} />

            <div className="grid grid-cols-2 sm:grid-cols-4 md:border-l border-border md:pl-7 gap-x-8 gap-y-4">
              <Stat label="Reference r" value={params.SP.toFixed(1)} />
              <Stat label="Error e = r&minus;y" value={error.toFixed(2)} />
              <Stat label="Control signal u(t)" value={`${Math.round(sim.u)} %`} />
              <Stat label="Simulation time" value={`${sim.t.toFixed(0)} s`} />
            </div>

            <div className="flex md:flex-col items-center md:items-end gap-2.5">
              <Badge variant={mode === 'PID' ? 'primary' : 'warning'} className="font-mono uppercase">
                Mode: {mode === 'PID' ? 'PID' : 'ON/OFF'}
              </Badge>
              <Badge
                variant={actuatorState === 'pos' ? 'destructive' : actuatorState === 'neg' ? 'primary' : 'secondary'}
                className="font-mono min-w-[7rem] justify-center"
              >
                {actuatorState === 'zero' ? 'ACTUATOR 0%' : `ACTUATOR ${sim.u > 0 ? '+' : ''}${Math.round(sim.u)}%`}
              </Badge>
              {sim.diverged && (
                <Badge variant="destructive" className="font-mono uppercase">
                  Output diverged
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div id="control-system" className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5 items-start scroll-mt-24">
          {/* Control panel */}
          <Card>
            <CardContent className="p-6">
              <SectionLabel>Control Mode</SectionLabel>
              <div className="flex border border-border rounded-lg overflow-hidden mb-6">
                <Button
                  variant={mode === 'PID' ? undefined : 'ghost'}
                  className="flex-1 rounded-none border-0"
                  onClick={() => setMode('PID')}
                >
                  PID
                </Button>
                <div className="w-px bg-border" />
                <Button
                  variant={mode === 'ONOFF' ? undefined : 'ghost'}
                  className="flex-1 rounded-none border-0"
                  onClick={() => setMode('ONOFF')}
                >
                  ON / OFF
                </Button>
              </div>

              {mode === 'PID' ? (
                <>
                  <Slider
                    label="Kp &mdash; Proportional gain"
                    hint="Reacts to the current error e = r − y. Higher Kp responds faster but overshoots more and can make the system oscillate."
                    value={params.Kp}
                    min={0}
                    max={60}
                    step={1}
                    onChange={(v) => patch({ Kp: v })}
                    format={(v) => v.toFixed(1)}
                  />
                  <Slider
                    label="Ki &mdash; Integral gain"
                    hint="Accumulates past error over time to eliminate steady-state offset. Too high causes slow oscillation and windup once u saturates."
                    value={params.Ki}
                    min={0}
                    max={15}
                    step={0.5}
                    onChange={(v) => patch({ Ki: v })}
                    format={(v) => v.toFixed(2)}
                  />
                  <Slider
                    label="Kd &mdash; Derivative gain"
                    hint="Reacts to how fast y is changing, adding damping. Higher Kd reduces overshoot but amplifies measurement noise."
                    value={params.Kd}
                    min={0}
                    max={15}
                    step={0.5}
                    onChange={(v) => patch({ Kd: v })}
                    format={(v) => v.toFixed(1)}
                  />
                </>
              ) : (
                <Slider
                  label="Hysteresis (&plusmn; &delta;)"
                  hint="Dead-band around the reference where the actuator holds its last state. Prevents rapid on/off chattering right at the setpoint; wider δ means more output ripple but fewer switches."
                  value={params.hyst}
                  min={0.05}
                  max={1.5}
                  step={0.05}
                  onChange={(v) => patch({ hyst: v })}
                  format={(v) => v.toFixed(2)}
                />
              )}

              <div className="h-px bg-border my-5" />

              <SectionLabel>Reference</SectionLabel>
              <Slider
                label="r &mdash; Reference (setpoint)"
                value={params.SP}
                min={-5}
                max={5}
                step={0.5}
                onChange={(v) => patch({ SP: v })}
                format={(v) => v.toFixed(1)}
              />

              <div className="h-px bg-border my-5" />

              <div className="flex items-center justify-between mb-4">
                <SectionLabel>
                  Plant G(s)
                  <InfoTip text="Any strictly proper transfer function works: the numerator order must be lower than the denominator order, e.g. 1 / (s²+9s+20). Try a preset below if you're not sure what to type." />
                </SectionLabel>
                <button
                  onClick={resetPlant}
                  className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground hover:text-foreground underline underline-offset-2 mb-4"
                >
                  Reset to default
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {PLANT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setNumText(p.num);
                      setDenText(p.den);
                      setMode('PID');
                      patch(p.gains);
                    }}
                    className="font-mono text-[10.5px] rounded-full border border-border bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <TextField label="Numerator coefficients (highest degree first)" value={numText} onChange={setNumText} placeholder="e.g. 1" />
              <TextField
                label="Denominator coefficients (highest degree first)"
                value={denText}
                onChange={setDenText}
                placeholder="e.g. 1, 9, 20"
              />
              {tfError ? (
                <p className="text-[12px] text-destructive mt-1.5 leading-snug">{tfError} Keeping the last valid G(s).</p>
              ) : (
                <p className="font-mono text-[12px] text-muted-foreground mt-1.5">
                  G(s) = {formatPolynomial(appliedNum)} / ({formatPolynomial(appliedDen)})
                </p>
              )}

              <div className="h-px bg-border my-5" />

              <SectionLabel>Simulation</SectionLabel>
              <div className="flex gap-2 mb-3">
                <Button className="flex-1" onClick={() => setRunning((r) => !r)}>
                  {running ? 'Pause' : 'Run'}
                </Button>
                <Button variant="outline" className="flex-1" onClick={sim.reset}>
                  Reset
                </Button>
              </div>
              <div className="flex gap-2">
                {[1, 5, 20].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={speed === s ? undefined : 'secondary'}
                    className="flex-1"
                    onClick={() => setSpeed(s)}
                  >
                    {s}&times;
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Charts & formulas */}
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground font-normal">
                  System output y(t)
                </CardTitle>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <Legend color="var(--color-chart-4)" label="y(t) measured" />
                  <Legend color="var(--color-chart-1)" dashed label="Reference r(t)" />
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto">
                  <ComposedChart data={sim.history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="yGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-4)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--color-chart-4)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(v: number) => `${v.toFixed(0)}s`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={ySpan}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                    />
                    <ReferenceLine y={params.SP} stroke="var(--color-chart-1)" strokeDasharray="5 4" strokeWidth={1.5} />
                    <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `t = ${v}s`} />} />
                    <Area type="monotone" dataKey="y" stroke="none" fill="url(#yGradient)" isAnimationActive={false} />
                    <Line
                      type="monotone"
                      dataKey="y"
                      stroke="var(--color-chart-4)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground font-normal">
                  Control signal u(t) &mdash; actuator
                </CardTitle>
                <Legend color="var(--color-chart-2)" label="u(t) (%)" />
              </CardHeader>
              <CardContent className="pt-4">
                <ChartContainer config={chartConfig} className="h-40 w-full aspect-auto">
                  <ComposedChart data={sim.history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(v: number) => `${v.toFixed(0)}s`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      domain={[-100, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `t = ${v}s`} />} />
                    <Line
                      type="monotone"
                      dataKey="u"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <SectionLabel>Model &amp; Equations Used</SectionLabel>
                <div className="grid md:grid-cols-2 gap-6">
                  <FormulaBlock title="Plant transfer function (editable)">
                    <FormulaBox>
                      G(s) = Y(s) / U(s) = {formatPolynomial(appliedNum)} / ({formatPolynomial(appliedDen)})
                    </FormulaBox>
                    <p className="text-[12.5px] text-muted-foreground mt-3 leading-relaxed">
                      Enter your own numerator and denominator coefficients on the left (highest degree first,
                      comma-separated). The simulator converts G(s) into a state-space model internally, so it
                      isn&apos;t locked to any single fixed plant.
                    </p>
                  </FormulaBlock>
                  <FormulaBlock title={`Control law — ${mode === 'PID' ? 'PID' : 'ON/OFF (hysteresis)'}`}>
                    {mode === 'PID' ? (
                      <>
                        <FormulaBox>
                          e(t) = r &minus; y(t)
                          <br />
                          u(t) = Kp&middot;e + Ki&middot;&int;e dt + Kd&middot;(&minus;dy/dt)
                          <br />
                          u(t) clamp &rarr; [&minus;100, 100] %
                        </FormulaBox>
                        <p className="text-[12.5px] text-muted-foreground mt-3 leading-relaxed">
                          The derivative term is computed straight from the plant&apos;s state derivative, not a
                          finite difference on the error, so it&apos;s free of derivative kick. The integral term is
                          clamped (anti-windup) so it can&apos;t pile up once u saturates.
                        </p>
                      </>
                    ) : (
                      <>
                        <FormulaBox>
                          if y &lt; r &minus; &delta; &rarr; u = +100 %
                          <br />
                          if y &gt; r + &delta; &rarr; u = &minus;100 %
                          <br />
                          otherwise &rarr; u holds its last state
                        </FormulaBox>
                        <p className="text-[12.5px] text-muted-foreground mt-3 leading-relaxed">
                          The &plusmn;&delta; hysteresis band keeps the actuator from chattering right around the
                          reference. A wider &delta; means more output ripple but fewer switches.
                        </p>
                      </>
                    )}
                  </FormulaBlock>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <CardDescription className="text-[12.5px] leading-relaxed border-t border-border pt-4">
          The plant is solved numerically (Euler-style RK4 integration, dt = 0.1 s) because ON/OFF control is
          nonlinear (hysteresis) and PID includes output saturation &mdash; neither reduces to a clean linear
          Laplace convolution. For classical linear stability analysis in PID mode without saturation, the standard
          feedback relation Y(s)/R(s) = C(s)G(s) / (1 + C(s)G(s)) still applies, with C(s) = Kp + Ki/s + Kd&middot;s.
        </CardDescription>

        <div id="pendulum" className="scroll-mt-24">
          <InvertedPendulum />
        </div>

        <Footer />
      </div>
      </div>
    </div>
  );
}

const NAV_SECTIONS = [
  { id: 'top', label: 'Overview' },
  { id: 'control-system', label: '2nd-Order' },
  { id: 'pendulum', label: 'Pendulum' },
];

function TopNav() {
  const [active, setActive] = useState('top');

  useEffect(() => {
    const targets = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto max-w-6xl h-16 px-4 md:px-8 flex items-center justify-between gap-3">
        <a href="#top" className="shrink-0 flex items-center">
          <img src="/physics-unpad.png" alt="Physics FMIPA Unpad" className="h-7 md:h-8 w-auto" />
        </a>
        <nav className="flex items-center gap-0.5 sm:gap-1">
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active === s.id ? 'true' : undefined}
              className={`whitespace-nowrap rounded-full px-2.5 sm:px-3 py-1.5 text-[12.5px] sm:text-[13px] font-medium transition-colors ${
                active === s.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border pt-5 text-center">
      <p className="font-mono text-[11px] tracking-wide text-muted-foreground">
        Instrumentation Module &mdash; Expert Physics Laboratorium &mdash; Dept. Physics, Faculty of Science,
        Padjadjaran University &copy; 2026
      </p>
    </footer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-1">
      <div className="font-mono text-[10.5px] tracking-wide uppercase text-muted-foreground mb-1.5 whitespace-nowrap">
        {label}
      </div>
      <div className="font-mono text-xl font-semibold text-foreground whitespace-nowrap">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground mb-4">{children}</div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2.5"
        style={dashed ? { borderTop: `2px dashed ${color}`, height: 0 } : { height: 2, backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function FormulaBlock({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h3 className="text-[15px] font-semibold mb-3 text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function FormulaBox({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[13.5px] bg-muted border border-border rounded-lg px-4 py-3.5 leading-[1.9] overflow-x-auto text-foreground">
      {children}
    </div>
  );
}
