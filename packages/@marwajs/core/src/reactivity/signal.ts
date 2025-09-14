import { track, trigger } from "./internals";

const SignalFlag: unique symbol = Symbol("isSignal");

export type Signal<T> = {
  (): T; // tracked read
  set(next: T): void; // write
  update(up: (prev: T) => T): void;
  peek(): T; // untracked read
  readonly [SignalFlag]: true;
};

export function isSignal<T = any>(s: unknown): s is Signal<T> {
  return !!(s as any)?.[SignalFlag];
}

class SignalCell<T> {
  private _value: T;
  constructor(v: T) {
    this._value = v;
  }
  read(): T {
    track(this, "value");
    return this._value;
  }
  write(v: T) {
    if (!Object.is(this._value, v)) {
      this._value = v;
      trigger(this, "value");
    }
  }
  peek(): T {
    return this._value;
  }
}

export function signal<T>(initial: T): Signal<T> {
  const cell = new SignalCell(initial);
  const fn = (() => cell.read()) as Signal<T>;
  Object.defineProperty(fn, SignalFlag, { value: true });
  fn.set = (v: T) => cell.write(v);
  fn.update = (up) => cell.write(up(cell.peek()));
  fn.peek = () => cell.peek();
  return fn;
}

export { SignalFlag };
