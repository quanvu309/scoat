export function boundTestFile(file, milliseconds = 180000) {
 const timer = setTimeout(() => {
  process.stderr.write(JSON.stringify({ event: "test_file_timeout", file, milliseconds, resources: process.getActiveResourcesInfo() }) + "\n");
  process.exit(1);
 }, milliseconds);
 timer.unref();
 return timer;
}

if (process.env.NODE_TEST_CONTEXT === "child-v8") boundTestFile(process.argv[1]);
