const { add } = require("./math");

describe("Math", () => {
  test("add(1, 1) = 2", () => {
    expect(add(1, 1)).toBe(2);
  });
});
