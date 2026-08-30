import { useCallback, useEffect, useRef, useState } from 'react';

export type PendulumParams = {
  Kp: number;
  Ki: number;
  Kd: number;
};

export type PendulumSample = { t: number; theta: number; u: number };

// Physical constants (fixed plant, same spirit as the order-2 system above:
// only the controller gains are tunable).
export const CART_MASS = 1.0; // kg
export const POLE_MASS = 0.1; // kg
export const HALF_LENGTH = 0.5; // m, pivot to pole center of mass
export const GRAVITY = 9.81; // m/s^2
export const FORCE_MAX = 100; // N, actuator saturation
export const TRACK_LIMIT = 4.0; // m, cart rail half-length
export const FAIL_ANGLE = (80 * Math.PI) / 180; // rad, pole considered "fallen" past this
export const DRAG_MAX_ANGLE = (78 * Math.PI) / 180; // rad, how far the cursor can drag the pole

const DT = 0.004; // physics integration step (s) - small for a stiff, nonlinear plant
const WINDOW = 8; // seconds of history kept for the strip chart
const HISTORY_DT = 0.03; // chart is sampled far coarser than the physics so it never bottlenecks rendering

type Vec4 = [number, number, number, number]; // [x, xdot, theta, thetadot]

type SimState = {
  t: number;
  state: Vec4;
  integral: number;
  u: number;
  fallen: false | 'angle' | 'track';
  dragging: boolean;
  nextSampleAt: number;
};

export type Pose = {
  t: number;
  x: number;
  xdot: number;
  theta: number;
  thetadot: number;
  u: number;
  fallen: false | 'angle' | 'track';
};

function freshSim(theta0: number): SimState {
  return { t: 0, state: [0, 0, theta0, 0], integral: 0, u: 0, fallen: false, dragging: false, nextSampleAt: 0 };
}

function poseOf(sim: SimState): Pose {
  const [x, xdot, theta, thetadot] = sim.state;
  return { t: sim.t, x, xdot, theta, thetadot, u: sim.u, fallen: sim.fallen };
}

/** Classic nonlinear cart-pole dynamics (Florian / Barto-Sutton-Anderson form). */
function derivative([, xdot, theta, thetadot]: Vec4, F: number): Vec4 {
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const totalMass = CART_MASS + POLE_MASS;
  const temp = (F + POLE_MASS * HALF_LENGTH * thetadot * thetadot * sinT) / totalMass;
  const thetaAcc =
    (GRAVITY * sinT - cosT * temp) / (HALF_LENGTH * (4 / 3 - (POLE_MASS * cosT * cosT) / totalMass));
  const xAcc = temp - (POLE_MASS * HALF_LENGTH * thetaAcc * cosT) / totalMass;
  return [xdot, xAcc, thetadot, thetaAcc];
}

function rk4Step(s: Vec4, F: number, dt: number): Vec4 {
  const add = (a: Vec4, b: Vec4, scale: number): Vec4 => [
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
    a[3] + b[3] * scale,
  ];
  const k1 = derivative(s, F);
  const k2 = derivative(add(s, k1, dt / 2), F);
  const k3 = derivative(add(s, k2, dt / 2), F);
  const k4 = derivative(add(s, k3, dt), F);
  return [
    s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    s[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    s[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
  ];
}

// Small, fixed assist that gently recenters the cart on the rail. The angle
// PID above has no notion of cart position, so left on its own the cart
// settles at whatever residual velocity a disturbance leaves it with and
// drifts indefinitely. Because F accelerates the cart directly, a PD term
// on (x, xdot) can ride along in the same force output to walk it back
// toward the middle - producing the side-to-side "shuffle" a real
// balancing cart shows while recovering.
//
// Counterintuitively the stabilizing sign here is *positive* (+Kx*x, not
// -Kx*x): because F also feeds back into the angle dynamics through the
// cart/pole coupling, the angle loop's own reaction to this term is what
// actually does the recentering, and linearizing the full closed loop
// (state = [x, xdot, theta, thetadot, integral]) shows the naive
// "restoring force" sign is the unstable one. Verified numerically before
// picking these gains.
const POS_KP = 1.8;
const POS_KD = 1.1;

// Combining Ki*integral(theta) with a position term creates a subtle bug:
// the integral can drift to any constant that exactly cancels Kx*x0 for
// some resting cart offset x0, turning every point on the rail into a
// valid equilibrium. A slow leak on the integral prevents it from ever
// settling anywhere except zero, which is what pins the cart to the
// middle rather than "wherever it happened to stop".
const INTEGRAL_LEAK = 0.15; // 1/s

/**
 * Control law: F = Kp*theta + Ki*integral(theta) + Kd*thetadot, plus the
 * fixed recentering assist above.
 *
 * Note the sign on the angle terms: this is proportional to the tilt
 * itself, not to a setpoint-minus-measurement error. An inverted pendulum
 * is an unstable plant, so stabilizing it means pushing the cart
 * *underneath* the direction it's falling (same sign as theta) rather
 * than "opposing" the error the way PID does for a passively stable
 * plant.
 */
function step(sim: SimState, params: PendulumParams, pushSample: (s: PendulumSample) => void) {
  if (sim.fallen || sim.dragging) return;

  const [x, xdot, theta, thetadot] = sim.state;
  sim.integral += (theta - INTEGRAL_LEAK * sim.integral) * DT;
  const iTerm = Math.max(-FORCE_MAX, Math.min(FORCE_MAX, params.Ki * sim.integral));
  let F = params.Kp * theta + iTerm + params.Kd * thetadot + POS_KP * x + POS_KD * xdot;
  F = Math.max(-FORCE_MAX, Math.min(FORCE_MAX, F));
  sim.u = F;

  sim.state = rk4Step(sim.state, F, DT);
  sim.t += DT;

  if (Math.abs(sim.state[2]) > FAIL_ANGLE) sim.fallen = 'angle';
  else if (Math.abs(sim.state[0]) > TRACK_LIMIT) sim.fallen = 'track';

  if (sim.t >= sim.nextSampleAt) {
    sim.nextSampleAt = sim.t + HISTORY_DT;
    pushSample({ t: sim.t, theta: sim.state[2], u: sim.u });
  }
}

export function usePendulumSim(params: PendulumParams, running: boolean, speed: number, initialTheta: number) {
  const simRef = useRef<SimState>(freshSim(initialTheta));
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const historyRef = useRef<PendulumSample[]>([{ t: 0, theta: initialTheta, u: 0 }]);

  const [pose, setPose] = useState<Pose>(() => poseOf(simRef.current));
  const [history, setHistory] = useState<PendulumSample[]>(historyRef.current);

  const pushSample = useCallback((s: PendulumSample) => {
    historyRef.current = [...historyRef.current, s];
    const cutoff = s.t - WINDOW;
    while (historyRef.current.length > 2 && historyRef.current[0].t < cutoff) historyRef.current.shift();
  }, []);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastTs: number | null = null;
    let lastHistoryFlush = 0;

    const loop = (ts: number) => {
      if (lastTs === null) lastTs = ts;
      const realDt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;

      const simSeconds = realDt * speed;
      const steps = Math.min(500, Math.round(simSeconds / DT));
      for (let i = 0; i < steps; i++) step(simRef.current, paramsRef.current, pushSample);

      // The live animation reads simRef directly every frame (see getPose /
      // PendulumAnimatedScene) so it stays at 60fps without re-rendering
      // this whole card. Everything else here (stats, chart) only needs a
      // few updates a second to look smooth, so it's throttled.
      if (ts - lastHistoryFlush > 350) {
        lastHistoryFlush = ts;
        setPose(poseOf(simRef.current));
        setHistory(historyRef.current);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, pushSample]);

  const reset = useCallback((theta0: number) => {
    simRef.current = freshSim(theta0);
    historyRef.current = [{ t: 0, theta: theta0, u: 0 }];
    setPose(poseOf(simRef.current));
    setHistory(historyRef.current);
  }, []);

  const disturb = useCallback((kick: number) => {
    simRef.current.state[3] += kick;
    simRef.current.fallen = false;
    setPose(poseOf(simRef.current));
  }, []);

  // Cursor-drag interaction: while dragging, the pole angle is driven
  // directly by the pointer and physics stepping is suspended; on release
  // the pole keeps whatever angular velocity the drag gesture implied.
  const beginDrag = useCallback(() => {
    simRef.current.dragging = true;
    simRef.current.fallen = false;
  }, []);

  const updateDrag = useCallback((theta: number) => {
    const sim = simRef.current;
    if (!sim.dragging) return;
    sim.state[2] = theta;
    // No setState here: this can fire far faster than 60Hz on some pointer
    // devices, and the animated scene already polls simRef every frame.
  }, []);

  const getPose = useCallback((): Pose => poseOf(simRef.current), []);

  const endDrag = useCallback((thetadot: number) => {
    const sim = simRef.current;
    sim.dragging = false;
    sim.state[3] = thetadot;
    sim.integral = 0;
    setPose(poseOf(sim));
  }, []);

  return {
    ...pose,
    history,
    reset,
    disturb,
    beginDrag,
    updateDrag,
    endDrag,
    getPose,
  };
}
