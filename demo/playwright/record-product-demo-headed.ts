import { runProductDemoRecording } from "./record-product-demo";

runProductDemoRecording({ headless: false })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
