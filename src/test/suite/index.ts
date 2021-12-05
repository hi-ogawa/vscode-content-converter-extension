import * as Mocha from "mocha";
// @ts-ignore
import { runMocha } from "mocha/lib/cli/run-helpers";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const runner = await runMocha(mocha, {
    spec: [__dirname],
    extension: ["test.js"],
    recursive: true,
  });

  return new Promise((resolve, reject) => {
    runner.on("end", () => {
      (runner.failures ? reject : resolve)(runner.failures);
    });
  });
}
