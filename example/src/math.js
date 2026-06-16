import { add, multiply } from './utils';

export function square(x) {
  return multiply(x, x);
}

export function cube(x) {
  return multiply(multiply(x, x), x);
}

export function sum(...numbers) {
  return numbers.reduce((acc, n) => add(acc, n), 0);
}

export function average(...numbers) {
  if (numbers.length === 0) return 0;
  return sum(...numbers) / numbers.length;
}

export class Calculator {
  constructor() {
    this.result = 0;
  }

  add(n) {
    this.result = add(this.result, n);
    return this;
  }

  multiply(n) {
    this.result = multiply(this.result, n);
    return this;
  }

  getResult() {
    return this.result;
  }
}

export default function calculate(expr) {
  return eval(expr);
}
