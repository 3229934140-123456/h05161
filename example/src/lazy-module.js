export function lazyFunction() {
  console.log('This is a lazy loaded function!');
  return 'Lazy loaded content';
}

export class LazyClass {
  constructor(name) {
    this.name = name;
  }

  greet() {
    return `Hello, ${this.name}!`;
  }
}

export default {
  description: 'This is a dynamically imported module',
  version: '1.0.0'
};
