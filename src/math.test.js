const { add, sub, mul, div } = require("./math");

describe("Math", () => {
  test("add(1, 1) = 2", () => {
    expect(add(1, 1)).toBe(2);
  });

  test("sub(5, 3) = 2", () => {
    expect(sub(5, 3)).toBe(2);
  });

  test("mul(5, 2) = 10", () => {
    expect(mul(5, 2)).toBe(10);
  });

  test("div(10, 2) = 5", () => {
    expect(div(10, 2)).toBe(5);
  });
});
