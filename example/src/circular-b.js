import { getAValue } from './circular-a';

export const bValue = 100;

export function getBValue() {
  return bValue;
}

export function getCombinedValueB() {
  return getBValue() + getAValue();
}
