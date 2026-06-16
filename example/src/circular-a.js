import { getBValue } from './circular-b';

export const aValue = 42;

export function getAValue() {
  return aValue;
}

export function getCombinedValue() {
  return getAValue() + getBValue();
}
