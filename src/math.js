/**
 * Adds two numbers
 * @param {number} a
 * @param {number} b
 * @returns {number} a + b
 **/
const add = (a, b) => b + a;

/**
 * Subtracts two numbers
 * @param {number} a
 * @param {number} b
 * @returns {number} a - b
 **/
const sub = (a, b) => a - b;

/**
 * Multiples two numbers
 * @param {number} a
 * @param {number} b
 * @returns {number} a * b
 **/
const mul = (a, b) => a * b;

/**
 * Divides two numbers
 * @param {number} a
 * @param {number} b
 * @returns {number} a / b
 **/
const div = (a, b) => a / b;

/**
 * Get the power of a number
 * @param {number} b Base number
 * @param {number} n Nth power
 * @returns {number} b^n
 **/
const pow = (b, n) => Math.pow(b, n);

module.exports = {
  add,
  sub,
  mul,
  div,
  pow,
};
