import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { outputOf, rk4StepGeneric, stateDerivative, toStateSpace, type StateSpace } from './transferFunction';

export type Mode = 'PID' | 'ONOFF';

export type Params = {
  Kp: number;
  Ki: number;
  Kd: number;
  hyst: number;
  SP: number;
};

export type Sample = { t: number; y: number; u: number };

const DT = 0.1; // integration step (s)
const WINDOW = 40; // seconds of history kept
const UMAX = 100; // actuator saturation (%)
const PUBLISH_MS = 90; // UI/chart update cadence, decoupled from the physics step rate

type SimState = {
  t: number;
  x: number[]; // plant state vector, order = ss.order
  lastU: number;
  integral: number;
  u: number;
  diverged: boolean;
  history: Sample[];
};

type Pose = { t: number; y: number; u: number; diverged: boolean };

function freshSim(order: number): SimState {
  return { t: 0, x: new Array(order).fill(0), lastU: 0, integral: 0, u: 0, diverged: false, history: [{ t: 0, y: 0, u: 0 }] };
}

function poseOf(sim: SimState, ss: StateSpace): Pose {
  return { t: sim.t, y: outputOf(sim.x, ss.C), u: sim.u, diverged: sim.diverged };
}

function step(sim: SimState, mode: Mode, params: Params, ss: StateSpace) {
  if (sim.diverged) return;

  const y = outputOf(sim.x, ss.C);
  const e = params.SP - y;

  if (mode === 'PID') {
    sim.integral += e * DT;
    const iTerm = Math.max(-UMAX, Math.min(UMAX, params.Ki * sim.integral));
    // Derivative on the previous control input avoids an algebraic loop
    // when the plant has direct numerator/denominator feedthrough.
    const dxPrev = stateDerivative(sim.x, sim.lastU, ss);
    const dy = outputOf(dxPrev, ss.C);
    sim.u = Math.max(-UMAX, Math.min(UMAX, params.Kp * e + iTerm + params.Kd * -dy));
  } else {
    const halfBand = params.hyst / 2;
    if (y < params.SP - halfBand) sim.u = UMAX;
    else if (y > params.SP + halfBand) sim.u = -UMAX;
    // else keep previous sim.u
  }

  sim.x = rk4StepGeneric(sim.x, sim.u, ss, DT);
  sim.lastU = sim.u;
  sim.t += DT;

  const yNew = outputOf(sim.x, ss.C);
  if (!Number.isFinite(yNew) || Math.abs(yNew) > 1e6) sim.diverged = true;

  // Build a new array rather than push/shift in place: the previous array
  // may already have been handed to React state (and frozen in dev mode),
  // so mutating it would throw on the next step.
  const cutoff = sim.t - WINDOW;
  const trimmed = sim.history[0] && sim.history[0].t < cutoff ? sim.history.filter((s) => s.t >= cutoff) : sim.history;
  sim.history = [...trimmed, { t: sim.t, y: yNew, u: sim.u }];
}

export function useOrder2Sim(
  mode: Mode,
  params: Params,
  running: boolean,
  speed: number,
  numCoeffs: number[],
  denCoeffs: number[],
) {
  const ss = useMemo(() => toStateSpace(numCoeffs, denCoeffs), [numCoeffs, denCoeffs]);

  const simRef = useRef<SimState>(freshSim(ss.order));
  const ssRef = useRef(ss);
  const paramsRef = useRef(params);
  const modeRef = useRef(mode);
  paramsRef.current = params;
  modeRef.current = mode;

  const [pose, setPose] = useState<Pose>(() => poseOf(simRef.current, ss));
  const [history, setHistory] = useState<Sample[]>(simRef.current.history);

  // A new G(s) changes the state dimension, so the old state vector can't
  // be reused - start over cleanly whenever the plant definition changes.
  useEffect(() => {
    ssRef.current = ss;
    simRef.current = freshSim(ss.order);
    setPose(poseOf(simRef.current, ss));
    setHistory(simRef.current.history);
  }, [ss]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastTs: number | null = null;
    let lastPublish = 0;

    const loop = (ts: number) => {
      if (lastTs === null) lastTs = ts;
      const realDt = Math.min(0.25, (ts - lastTs) / 1000);
      lastTs = ts;

      const simSeconds = realDt * speed;
      const steps = Math.min(400, Math.round(simSeconds / DT));
      for (let i = 0; i < steps; i++) step(simRef.current, modeRef.current, paramsRef.current, ssRef.current);

      if (ts - lastPublish > PUBLISH_MS) {
        lastPublish = ts;
        setPose(poseOf(simRef.current, ssRef.current));
        setHistory(simRef.current.history);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  const reset = useCallback(() => {
    simRef.current = freshSim(ssRef.current.order);
    setPose(poseOf(simRef.current, ssRef.current));
    setHistory(simRef.current.history);
  }, []);

  return { ...pose, history, reset, UMAX };
}
