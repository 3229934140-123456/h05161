import { add, multiply, PI, formatNumber } from './utils';
import { square, Calculator, average } from './math';
import calculate from './math';
import { getCombinedValue } from './circular-a';
import { getCombinedValueB } from './circular-b';

console.log('=== Mini Bundler Demo ===');
console.log('');

console.log('Utils:');
console.log('add(2, 3) =', add(2, 3));
console.log('multiply(4, 5) =', multiply(4, 5));
console.log('PI =', PI);
console.log('formatNumber(3.14159) =', formatNumber(3.14159));
console.log('');

console.log('Math:');
console.log('square(5) =', square(5));
console.log('average(1, 2, 3, 4, 5) =', average(1, 2, 3, 4, 5));
console.log('calculate("10 + 20") =', calculate('10 + 20'));
console.log('');

const calc = new Calculator();
console.log('Calculator:');
console.log('calc.add(10).multiply(2).getResult() =', calc.add(10).multiply(2).getResult());
console.log('');

console.log('Circular Dependencies:');
console.log('getCombinedValue() =', getCombinedValue());
console.log('getCombinedValueB() =', getCombinedValueB());
console.log('');

console.log('Dynamic Import:');
console.log('Loading lazy module...');

import('./lazy-module').then((module) => {
  console.log('Lazy module loaded!');
  console.log('lazyFunction() =', module.lazyFunction());

  const lazy = new module.LazyClass('World');
  console.log('LazyClass.greet() =', lazy.greet());
  console.log('default export =', module.default);
}).catch((err) => {
  console.error('Failed to load lazy module:', err);
});

document.addEventListener('click', () => {
  import('./lazy-module').then((module) => {
    module.lazyFunction();
  });
});
