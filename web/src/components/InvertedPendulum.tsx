import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  DRAG_MAX_ANGLE,
  FAIL_ANGLE,
  HALF_LENGTH,
  TRACK_LIMIT,
  usePendulumSim,
  type PendulumParams,
  type Pose,
} from '@/lib/usePendulumSim';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';

const pendulumChartConfig = {
  theta: { label: 'θ (degrees)', color: 'var(--color-chart-3)' },
  u: { label: 'u (N)', color: 'var(--color-chart-5)' },
} satisfies ChartConfig;

function randomTilt() {
  const sign = Math.random() < 0.5 ? -1 : 1;
  return sign * (0.08 + Math.random() * 0.08); // ~4.6 deg to 9.2 deg
}

function PendulumSlider({
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

// Scene geometry, all derived from the same physical constants used by the
// simulation so the drawing can never drift out of sync with the physics.
// Margins are sized to fit the pole at its full drag range (+/-DRAG_MAX_ANGLE)
// with the cart at the far end of the rail, so nothing gets clipped.
const SCALE = 62; // px per metre
const VIEW_W = 760;
const VIEW_H = 260;
const GROUND_Y = 230;
const CART_W = 76;
const CART_H = 40;
const POLE_LEN_PX = HALF_LENGTH * 2 * SCALE * 1.7;
const BOB_R = 11;
const CENTER_X = VIEW_W / 2;

type DragCallbacks = {
  onDragStart: () => void;
  onDragMove: (theta: number) => void;
  onDragEnd: (thetadot: number) => void;
};

function PendulumScene({
  x,
  theta,
  severity,
  onDragStart,
  onDragMove,
  onDragEnd,
}: { x: number; theta: number; severity: number } & DragCallbacks) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ active: boolean; samples: { theta: number; t: number }[] }>({
    active: false,
    samples: [],
  });
  const pivotRef = useRef({ x: CENTER_X, y: GROUND_Y - CART_H });

  const cartX = CENTER_X + x * SCALE;
  const cartTopY = GROUND_Y - CART_H;
  const pivotX = cartX;
  const pivotY = cartTopY;
  pivotRef.current = { x: pivotX, y: pivotY };

  const color = severity < 0.4 ? '#5EE3A3' : severity < 0.75 ? '#F2C25A' : '#FF8F8F';
  const trackPx = TRACK_LIMIT * SCALE;

  const toSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const angleFromPointer = (clientX: number, clientY: number) => {
    const { x: px, y: py } = toSvgPoint(clientX, clientY);
    const { x: pvx, y: pvy } = pivotRef.current;
    const raw = Math.atan2(px - pvx, -(py - pvy));
    return Math.max(-DRAG_MAX_ANGLE, Math.min(DRAG_MAX_ANGLE, raw));
  };

  const handlePointerDown = (e: ReactPointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { active: true, samples: [] };
    onDragStart();
    onDragMove(angleFromPointer(e.clientX, e.clientY));
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragRef.current.active) return;
    const a = angleFromPointer(e.clientX, e.clientY);
    dragRef.current.samples.push({ theta: a, t: performance.now() });
    if (dragRef.current.samples.length > 6) dragRef.current.samples.shift();
    onDragMove(a);
  };

  const endDrag = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const samples = dragRef.current.samples;
    let thetadot = 0;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.001) thetadot = (b.theta - a.theta) / dt;
    }
    thetadot = Math.max(-15, Math.min(15, thetadot));
    onDragEnd(thetadot);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
  };

  const bobX = pivotX + POLE_LEN_PX * Math.sin(theta);
  const bobY = pivotY - POLE_LEN_PX * Math.cos(theta);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto select-none touch-none">
      {/* track */}
      <line
        x1={CENTER_X - trackPx}
        y1={GROUND_Y + 4}
        x2={CENTER_X + trackPx}
        y2={GROUND_Y + 4}
        stroke="var(--border)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line x1={CENTER_X - trackPx} y1={GROUND_Y - 6} x2={CENTER_X - trackPx} y2={GROUND_Y + 14} stroke="var(--border)" strokeWidth={3} />
      <line x1={CENTER_X + trackPx} y1={GROUND_Y - 6} x2={CENTER_X + trackPx} y2={GROUND_Y + 14} stroke="var(--border)" strokeWidth={3} />

      {/* upright reference guide */}
      <line
        x1={pivotX}
        y1={pivotY}
        x2={pivotX}
        y2={pivotY - POLE_LEN_PX - 14}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeDasharray="3 5"
        opacity={0.5}
      />

      {/* cart */}
      <g transform={`translate(${cartX - CART_W / 2}, ${cartTopY})`}>
        <rect width={CART_W} height={CART_H} rx={8} fill="var(--card)" stroke="var(--foreground)" strokeWidth={2} />
        <circle cx={CART_W * 0.24} cy={CART_H} r={7} fill="var(--muted-foreground)" />
        <circle cx={CART_W * 0.76} cy={CART_H} r={7} fill="var(--muted-foreground)" />
      </g>

      {/* pole */}
      <line x1={pivotX} y1={pivotY} x2={bobX} y2={bobY} stroke={color} strokeWidth={6} strokeLinecap="round" />
      <circle cx={pivotX} cy={pivotY} r={5} fill="var(--foreground)" />

      {/* draggable bob: visible dot plus a generous invisible hit-area */}
      <circle cx={bobX} cy={bobY} r={BOB_R} fill={color} style={{ pointerEvents: 'none' }} />
      <circle
        cx={bobX}
        cy={bobY}
        r={BOB_R + 14}
        fill="transparent"
        stroke="none"
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </svg>
  );
}

/**
 * Drives the animation at a steady 60fps by polling the simulation ref
 * directly (via getPose) inside its own requestAnimationFrame loop, and
 * only re-rendering this small subtree. Everything else in the card
 * (sliders, stat numbers, the Recharts strip chart) lives in the parent
 * and updates far less often, so the physics loop never has to drag a big
 * component tree through 60 renders a second to look smooth.
 */
function PendulumAnimatedScene({ getPose, onDragStart, onDragMove, onDragEnd }: { getPose: () => Pose } & DragCallbacks) {
  const [, forceRepaint] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      forceRepaint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { x, theta, fallen } = getPose();
  const severity = Math.min(1, Math.abs(theta) / FAIL_ANGLE);

  return (
    <PendulumScene
      x={x}
      theta={theta}
      severity={fallen ? 1 : severity}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    />
  );
}

export default function InvertedPendulum() {
  const [params, setParams] = useState<PendulumParams>({ Kp: 40, Ki: 1.2, Kd: 4 });
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [initialTheta, setInitialTheta] = useState(() => randomTilt());
  const [dragging, setDragging] = useState(false);

  const pend = usePendulumSim(params, running, speed, initialTheta);

  useEffect(() => {
    if (pend.fallen) setRunning(false);
  }, [pend.fallen]);

  const patch = (p: Partial<PendulumParams>) => setParams((prev) => ({ ...prev, ...p }));

  const handleReset = () => {
    const theta0 = randomTilt();
    setInitialTheta(theta0);
    pend.reset(theta0);
    setRunning(false);
  };

  const handleDisturb = () => {
    const sign = Math.random() < 0.5 ? -1 : 1;
    pend.disturb(sign * (0.9 + Math.random() * 0.9));
    if (!running) setRunning(true);
  };

  const handleDragStart = () => {
    setDragging(true);
    setRunning(true);
    pend.beginDrag();
  };

  const handleDragEnd = (thetadot: number) => {
    setDragging(false);
    pend.endDrag(thetadot);
  };

  const severity = Math.min(1, Math.abs(pend.theta) / FAIL_ANGLE);
  const thetaDeg = (pend.theta * 180) / Math.PI;
  const thetaDotDeg = (pend.thetadot * 180) / Math.PI;

  const chartData = useMemo(
    () => pend.history.map((h) => ({ t: h.t, theta: (h.theta * 180) / Math.PI, u: h.u })),
    [pend.history],
  );

  return (
    <Card>
      <CardHeader className="flex-col items-start justify-center gap-1.5 py-5">
        <div className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
          Bonus Simulation
        </div>
        <CardTitle className="font-serif text-2xl md:text-[1.75rem] font-medium tracking-tight text-foreground">
          Inverted Pendulum &mdash; PID Control
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        <p className="text-muted-foreground text-sm leading-relaxed mb-5 max-w-3xl">
          A freely-rolling cart carries a freely-hinged pole; PID keeps the pole upright (&theta; = 0&deg;) by moving
          the cart. Because this plant is naturally unstable, the control force is proportional directly to the tilt
          itself: u(t) = Kp&middot;&theta; + Ki&middot;&int;&theta; dt + Kd&middot;&theta;&prime;(t). A small, fixed
          position feedback (not adjustable) is also included so the cart drifts back toward the center of the rail
          instead of wandering indefinitely &mdash; that&apos;s what makes it visibly rock side to side while it
          balances.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5 items-start">
          {/* Controls */}
          <div>
            <div className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground mb-4">
              PID Constants
            </div>
            <PendulumSlider
              label="Kp &mdash; Proportional gain"
              hint="Force proportional to the tilt angle θ itself (not r − θ, since this plant is unstable). Higher Kp reacts faster to a lean but overshoots more."
              value={params.Kp}
              min={0}
              max={80}
              step={1}
              onChange={(v) => patch({ Kp: v })}
              format={(v) => v.toFixed(1)}
            />
            <PendulumSlider
              label="Ki &mdash; Integral gain"
              hint="Accumulates tilt over time. A small leak keeps it from drifting to a false equilibrium; too much Ki here makes recovery sluggish or oscillatory."
              value={params.Ki}
              min={0}
              max={10}
              step={0.2}
              onChange={(v) => patch({ Ki: v })}
              format={(v) => v.toFixed(2)}
            />
            <PendulumSlider
              label="Kd &mdash; Derivative gain"
              hint="Damps the angular velocity θ′. Higher Kd settles the pole faster with less overshoot, but too much makes the response sluggish."
              value={params.Kd}
              min={0}
              max={30}
              step={0.5}
              onChange={(v) => patch({ Kd: v })}
              format={(v) => v.toFixed(1)}
            />

            <div className="h-px bg-border my-5" />

            <div className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground mb-4">Simulation</div>
            <div className="flex gap-2 mb-2">
              <Button className="flex-1" disabled={!!pend.fallen || dragging} onClick={() => setRunning((r) => !r)}>
                {running ? 'Pause' : 'Run'}
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleReset}>
                Reset
              </Button>
            </div>
            <Button variant="secondary" className="w-full mb-3" onClick={handleDisturb} disabled={dragging}>
              Random Disturbance
            </Button>
            <div className="flex gap-2">
              {[0.5, 1, 2].map((s) => (
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
          </div>

          {/* Animation + readouts */}
          <div>
            <div className="rounded-lg border border-border bg-muted/40 p-3 relative">
              <PendulumAnimatedScene
                getPose={pend.getPose}
                onDragStart={handleDragStart}
                onDragMove={pend.updateDrag}
                onDragEnd={handleDragEnd}
              />
              {pend.fallen && !dragging && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Badge variant="destructive" className="font-mono uppercase px-4 py-1.5 text-[13px]">
                    {pend.fallen === 'angle' ? 'Pendulum fell' : 'Cart left the rail'}
                  </Badge>
                </div>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground mt-2 text-center">
              Drag the ball at the end of the pole to disturb its balance directly, then let go and watch PID
              recover it.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-y-3 gap-x-2 mt-4">
              <Stat label="Angle θ" value={`${thetaDeg.toFixed(1)}°`} />
              <Stat label="Angular rate θ'" value={`${thetaDotDeg.toFixed(0)}°/s`} />
              <Stat label="Cart position x" value={`${pend.x.toFixed(2)} m`} />
              <Stat label="Control force u" value={`${pend.u.toFixed(1)} N`} />
              <Stat label="Time" value={`${pend.t.toFixed(1)} s`} />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
                  Angle θ(t)
                </span>
                <Badge variant={pend.fallen ? 'destructive' : severity < 0.4 ? 'success' : 'warning'}>
                  {dragging ? 'DRAGGED' : pend.fallen ? 'FELL' : severity < 0.4 ? 'BALANCED' : 'UNSTEADY'}
                </Badge>
              </div>
              <ChartContainer config={pendulumChartConfig} className="h-32 w-full aspect-auto">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v: number) => `${v.toFixed(0)}s`}
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={[-60, 60]}
                    tickFormatter={(v: number) => `${v}°`}
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `t = ${v}s`} />} />
                  <Line
                    type="monotone"
                    dataKey="theta"
                    stroke="var(--color-chart-3)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wide uppercase text-muted-foreground mb-1 whitespace-nowrap">
        {label}
      </div>
      <div className="font-mono text-base font-semibold text-foreground whitespace-nowrap">{value}</div>
    </div>
  );
}
