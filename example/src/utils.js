export const add = (a, b) => a + b;
export const subtract = (a, b) => a - b;
export const multiply = (a, b) => a * b;
export const divide = (a, b) => a / b;

export const PI = 3.14159;
export const E = 2.71828;

export function formatNumber(num) {
  return num.toFixed(2);
}

export function parseNumber(str) {
  return parseFloat(str);
}
