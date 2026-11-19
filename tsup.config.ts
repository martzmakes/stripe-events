import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "runtime/index": "src/runtime/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  // aws-cdk-lib / constructs (peers) and @aws-sdk/client-dynamodb (dep) are
  // externalized automatically by tsup. The two entry points keep their import
  // graphs separate: importing the constructs entry never pulls in the AWS SDK,
  // and importing /runtime never pulls in aws-cdk-lib.
});
